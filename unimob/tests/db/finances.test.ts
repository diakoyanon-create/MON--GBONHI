import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, closeDb, createUser, sql, type Who } from './helpers';

let admin: Who, comptable: Who, agent: Who;
beforeAll(async () => {
  admin = await createUser('admin');
  comptable = await createUser('comptable');
  agent = await createUser('agent');
});
afterAll(closeDb);

async function newEntry(expected = 1000000) {
  const [e] = await as(comptable, (q) =>
    q(`insert into financial_entries (entry_type, amount_expected, status, description) values ('honoraires', $1, 'exigible', 'Test') returning id, reference`, [expected]));
  return e as { id: string; reference: string };
}
const pay = (entryId: string, amount: number, extra: { correction?: boolean; note?: string } = {}) =>
  as(comptable, (q) =>
    q(`insert into payments (financial_entry_id, paid_on, amount, method, is_correction, note) values ($1, current_date, $2, 'mobile_money', $3, $4)`,
      [entryId, amount, extra.correction ?? false, extra.note ?? null]));
const entry = async (id: string) =>
  (await sql('select amount_expected::bigint, amount_received::bigint, balance::bigint, status from financial_entries where id = $1', [id]))[0];

describe('Encaissements et soldes', () => {
  it('calcule encaissements partiels, solde et statut', async () => {
    const e = await newEntry(1000000);
    expect(e.reference).toMatch(/^REC-/);
    await pay(e.id, 300000);
    expect(await entry(e.id)).toEqual({ amount_expected: '1000000', amount_received: '300000', balance: '700000', status: 'partiel' });
    await pay(e.id, 700000);
    expect(await entry(e.id)).toEqual({ amount_expected: '1000000', amount_received: '1000000', balance: '0', status: 'encaisse' });
  });

  it('refuse un encaissement supérieur au montant attendu', async () => {
    const e = await newEntry(500000);
    await pay(e.id, 400000);
    await expect(pay(e.id, 200000)).rejects.toThrow(/dépasse le montant attendu/);
    expect((await entry(e.id)).amount_received).toBe('400000');
  });

  it('une correction est une ligne négative motivée, jamais une modification', async () => {
    const e = await newEntry(500000);
    await pay(e.id, 500000);
    await expect(pay(e.id, -100000)).rejects.toThrow(/check constraint/);
    await pay(e.id, -100000, { correction: true, note: 'Erreur de saisie, reçu n°12' });
    expect(await entry(e.id)).toMatchObject({ amount_received: '400000', balance: '100000', status: 'partiel' });
    await expect(as(comptable, (q) => q(`update payments set amount = 1 where financial_entry_id = $1`, [e.id]))).rejects.toThrow(/permission denied/);
    await expect(as(admin, (q) => q(`delete from payments where financial_entry_id = $1`, [e.id]))).rejects.toThrow(/permission denied/);
    const logs = await sql(`select * from activity_logs where entity_type = 'payments' and changes ->> 'financial_entry_id' = $1`, [e.id]);
    expect(logs).toHaveLength(2);
  });

  it('le montant encaissé ne peut pas être modifié directement', async () => {
    const e = await newEntry(500000);
    await expect(
      as(comptable, (q) => q(`update financial_entries set amount_received = 500000 where id = $1`, [e.id])),
    ).rejects.toThrow(/calculé à partir des encaissements/);
    await expect(
      as(comptable, (q) => q(`insert into financial_entries (entry_type, amount_expected, amount_received) values ('autre', 100, 100) returning amount_received`)),
    ).resolves.toEqual([{ amount_received: '0' }]);
  });

  it('les statuts partiel/encaissé ne se forcent pas à la main', async () => {
    const e = await newEntry(1000);
    await expect(
      as(comptable, (q) => q(`update financial_entries set status = 'encaisse' where id = $1`, [e.id])),
    ).rejects.toThrow(/calculés à partir des encaissements/);
    await pay(e.id, 400);
    await expect(
      as(comptable, (q) => q(`update financial_entries set status = 'exigible' where id = $1`, [e.id])),
    ).rejects.toThrow(/calculés à partir des encaissements/);
  });

  it('les recettes ne sont jamais supprimables via l’API', async () => {
    const e = await newEntry(1000);
    await expect(as(admin, (q) => q(`delete from financial_entries where id = $1`, [e.id]))).rejects.toThrow(/permission denied/);
  });

  it('pas d’encaissement sur une recette annulée', async () => {
    const e = await newEntry(1000);
    await as(comptable, (q) => q(`update financial_entries set status = 'annule' where id = $1`, [e.id]));
    await expect(pay(e.id, 500)).rejects.toThrow(/annulée/);
  });

  it("l'agent ne peut ni créer de recette ni encaisser", async () => {
    await expect(
      as(agent, (q) => q(`insert into financial_entries (entry_type, amount_expected) values ('autre', 100)`)),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('Commissions', () => {
  it('estimation : pourcentage avec minimum, forfait, autre', async () => {
    const [r] = await sql(`select
      estimate_commission(10000000, 'pourcentage', 5, null, 250000) as pct,
      estimate_commission(1000000, 'pourcentage', 5, null, 250000) as mini,
      estimate_commission(10000000, 'fixe', null, 500000) as fixe,
      estimate_commission(10000000, 'autre', null, null) as autre,
      estimate_commission(33333333, 'pourcentage', 3, null) as arrondi`);
    expect(r).toEqual({ pct: '500000', mini: '250000', fixe: '500000', autre: null, arrondi: '1000000' });
  });

  it('distingue estimée, convenue, exigible, encaissée et solde', async () => {
    const [ctx] = await sql(`
      with o as (insert into owners (last_name, phone_primary) values ('COM', '0700000077') returning id),
           p as (insert into properties (property_type, title, city, owner_id, price_xof) select 'terrain', 'Terrain commission', 'Abidjan', id, 40000000 from o returning id, owner_id),
           b as (insert into buyers (last_name, phone) values ('COMACH', '0700000078') returning id)
      select p.id as property_id, p.owner_id, b.id as buyer_id, (select id from commission_rules where calc_type = 'pourcentage' limit 1) as rule_id from p, b`);
    const [t] = await as(admin, (q) =>
      q(`insert into transactions (property_id, buyer_id, owner_id, initial_asking_price, commission_rule_id) values ($1, $2, $3, 40000000, $4) returning id`,
        [ctx.property_id, ctx.buyer_id, ctx.owner_id, ctx.rule_id]));
    let [c] = await as(comptable, (q) => q('select * from transaction_commissions where transaction_id = $1', [t.id]));
    expect(c).toMatchObject({ commission_estimated: '2000000', commission_agreed: null, commission_due: '0', commission_received: '0' });

    await as(admin, (q) => q(`update transactions set agreed_price = 38000000, commission_agreed = 1800000, status = 'vente_conclue', concluded_date = current_date where id = $1`, [t.id]));
    [c] = await as(comptable, (q) => q('select * from transaction_commissions where transaction_id = $1', [t.id]));
    expect(c).toMatchObject({ commission_estimated: '1900000', commission_agreed: '1800000', commission_due: '1800000', commission_received: '0', commission_balance: '1800000' });

    const [fe] = await sql(`select id from financial_entries where transaction_id = $1`, [t.id]);
    await pay(fe.id, 1000000);
    [c] = await as(comptable, (q) => q('select * from transaction_commissions where transaction_id = $1', [t.id]));
    expect(c).toMatchObject({ commission_received: '1000000', commission_balance: '800000' });
  });
});

describe('Rapports et tableau de bord', () => {
  it('le rapport financier ne confond pas attendu et encaissé', async () => {
    const [{ r }] = await as(comptable, (q) => q(`select finance_report(current_date - 365, current_date + 1) r`));
    const [{ expected, received }] = await sql(`select coalesce(sum(amount_expected), 0)::bigint expected,
      (select coalesce(sum(amount), 0)::bigint from payments) received from financial_entries where status <> 'annule'`);
    expect(String(r.revenues_expected)).toBe(expected);
    expect(String(r.revenues_received)).toBe(received);
    const [{ dep }] = await sql(`select coalesce(sum(amount), 0)::bigint dep from expenses where expense_date between current_date - 365 and current_date + 1`);
    expect(String(r.expenses_total)).toBe(dep);
    expect(Number(r.result)).toBe(Number(received) - Number(dep));
    expect(r.expenses_by_category.length).toBeGreaterThan(0);
  });

  it('rejette une période invalide', async () => {
    await expect(as(comptable, (q) => q(`select finance_report(current_date, current_date - 1)`))).rejects.toThrow(/Période invalide/);
  });

  it('le tableau de bord du comptable contient les indicateurs financiers distincts', async () => {
    const [{ d }] = await as(comptable, (q) => q(`select dashboard_stats(current_date - 30, current_date) d`));
    expect(d.finance).toBeDefined();
    for (const k of ['commissions_estimated', 'commissions_agreed', 'commissions_due_balance', 'commissions_received', 'revenue_received', 'expenses', 'result']) {
      expect(d.finance[k]).not.toBeUndefined();
    }
    expect(Number(d.finance.result)).toBe(Number(d.finance.revenue_received) - Number(d.finance.expenses));
    expect(d.owners).toBeUndefined(); // pas d'accès commercial
  });

  it('les dépenses exigent un montant positif', async () => {
    await expect(
      as(comptable, (q) => q(`insert into expenses (category, description, amount, payment_method) values ('Autre', 'Négative', -5, 'especes')`)),
    ).rejects.toThrow(/check constraint/);
    const [e] = await as(comptable, (q) => q(`insert into expenses (category, description, amount, payment_method) values ('Autre', 'OK', 5000, 'especes') returning reference`));
    expect(e.reference).toMatch(/^DEP-/);
  });
});

describe('Tâches', () => {
  it('date de fin automatique et tâches en retard au tableau de bord', async () => {
    const before = (await as(agent, (q) => q('select dashboard_stats() d')))[0].d.tasks_overdue;
    const [t] = await as(agent, (q) => q(`insert into tasks (title, due_at) values ('Retard test', now() - interval '2 hours') returning id, assigned_to`));
    expect(t.assigned_to).toBe(agent.uid);
    let d = (await as(agent, (q) => q('select dashboard_stats() d')))[0].d;
    expect(d.tasks_overdue).toBe(before + 1);
    await as(agent, (q) => q(`update tasks set status = 'terminee', result = 'Fait' where id = $1`, [t.id]));
    const [row] = await sql('select completed_at from tasks where id = $1', [t.id]);
    expect(row.completed_at).not.toBeNull();
    d = (await as(agent, (q) => q('select dashboard_stats() d')))[0].d;
    expect(d.tasks_overdue).toBe(before);
  });
});
