// Projet Supabase récent : aucun privilège n'est accordé automatiquement aux rôles
// anon/authenticated sur les nouveaux objets. Les migrations doivent tout accorder
// explicitement, sinon l'espace privé et le site public renvoient « permission denied ».
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error script JS sans types
import { resetDatabase } from '../../scripts/db-reset.mjs';
import { anon, as, closeDb, createUser, sql, useDatabase, type Who } from './helpers';

let admin: Who, agent: Who, comptable: Who;
beforeAll(async () => {
  const url: string = await resetDatabase({ seed: true, strictGrants: true, name: 'unimob_test_strict' });
  await useDatabase(url);
  admin = await createUser('admin');
  agent = await createUser('agent');
  comptable = await createUser('comptable');
}, 60000);
afterAll(closeDb);

describe('Privilèges explicites (sans privilèges par défaut)', () => {
  it('la base de test n’a vraiment aucun privilège par défaut', async () => {
    const [r] = await sql(`select count(*)::int n from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
                            where n.nspname = 'public' and d.defaclobjtype = 'r'`);
    expect(r.n).toBe(0);
  });

  it('EXECUTE n’est plus accordé par défaut : une fonction créée ensuite n’est pas exécutable par anon', async () => {
    // Révocation globale (defaclnamespace = 0) : la forme « in schema public » était sans effet.
    const [r] = await sql(`select count(*)::int n from pg_default_acl where defaclobjtype = 'f' and defaclnamespace = 0
                            and defaclrole = 'postgres'::regrole and not exists (
                              select 1 from aclexplode(defaclacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')`);
    expect(r.n).toBe(1);
    await sql(`create or replace function public.zz_sonde_stricte() returns int language sql as 'select 1'`);
    try {
      const [p] = await sql(`select has_function_privilege('anon', 'public.zz_sonde_stricte()', 'execute') a,
                                    has_function_privilege('authenticated', 'public.zz_sonde_stricte()', 'execute') b`);
      expect(p).toEqual({ a: false, b: false });
      await expect(as(anon, (q) => q('select public.zz_sonde_stricte()'))).rejects.toThrow(/permission denied/);
    } finally {
      await sql('drop function public.zz_sonde_stricte()');
    }
    // unaccent, créée par la migration 1 après la révocation, est rendue exécutable par la migration 8
    // (vue public_properties et property_matches sont évaluées avec les droits de l'appelant).
    const [e] = await sql(`select has_function_privilege('anon', 'extensions.unaccent(text)', 'execute') a,
                                  has_function_privilege('authenticated', 'extensions.unaccent(text)', 'execute') u`);
    expect(e).toEqual({ a: true, u: true });
  });

  it('le site public fonctionne pour un visiteur', async () => {
    expect((await as(anon, (q) => q('select reference from public_properties'))).length).toBeGreaterThan(0);
    await as(anon, (q) => q(`select reference, search_text from public_properties where search_text like '%abidjan%' or district_search <> ''`));
    expect((await as(anon, (q) => q('select id from public_property_photos'))).length).toBeGreaterThan(0);
    expect((await as(anon, (q) => q('select agency_name from public_agency_info'))).length).toBe(1);
    const [{ r }] = await as(anon, (q) => q(`select submit_inquiry('Visiteur Strict', '+225 07 00 11 22 33', 'Bonjour, test strict', p_consent => true) r`));
    expect(r.ok).toBe(true);
    await expect(as(anon, (q) => q('select * from owners'))).rejects.toThrow(/permission denied/);
  });

  it('un agent lit, crée et modifie ses données ; appelle les RPC', async () => {
    const [o] = await as(agent, (q) => q(`insert into owners (last_name, phone_primary) values ('STRICT', '0700000001') returning id`));
    const [p] = await as(agent, (q) => q(`insert into properties (property_type, title, city, owner_id) values ('maison', 'Maison stricte', 'Abidjan', $1) returning id`, [o.id]));
    await as(agent, (q) => q(`update properties set price_xof = 1000 where id = $1`, [p.id]));
    await as(agent, (q) => q(`insert into tasks (title) values ('Tâche stricte')`));
    expect((await as(agent, (q) => q('select dashboard_stats() d')))[0].d.properties.total).toBeGreaterThan(0);
    expect(await as(agent, (q) => q('select publication_blockers($1) b', [p.id]))).toHaveLength(1);
    await as(agent, (q) => q(`select * from find_duplicate_contacts('0700000001', null)`));
    await as(agent, (q) => q('select run_maintenance()'));
    const [i] = await sql(`select id from inquiries where full_name = 'Visiteur Strict'`);
    await as(agent, (q) => q('select convert_inquiry_to_buyer($1)', [i.id]));
    const [b] = await sql(`select id from buyers order by created_at desc limit 1`);
    await as(agent, (q) => q('select * from property_matches($1)', [b.id]));
    await as(agent, (q) => q(`select log_event('export_csv', 'properties', null, 'test')`));
  });

  it('le comptable gère les finances ; l’admin les paramètres et le journal', async () => {
    const [e] = await as(comptable, (q) => q(`insert into financial_entries (entry_type, amount_expected, status) values ('autre', 1000, 'exigible') returning id`));
    await as(comptable, (q) => q(`insert into payments (financial_entry_id, paid_on, amount, method) values ($1, current_date, 500, 'especes')`, [e.id]));
    await as(comptable, (q) => q(`select finance_report(current_date - 30, current_date)`));
    expect((await as(comptable, (q) => q('select * from transaction_commissions'))).length).toBeGreaterThanOrEqual(0);
    await as(admin, (q) => q(`update agency_settings set tagline = 'Strict'`));
    expect((await as(admin, (q) => q('select * from activity_logs limit 1'))).length).toBe(1);
    await as(admin, (q) => q(`select anonymize_owner(id) from owners where last_name = 'STRICT'`));
  });

  it('les règles de la migration 0008 fonctionnent sans privilèges par défaut', async () => {
    // Membre connecté passant par le formulaire public, conversion puis anonymisation (journal expurgé).
    const [{ r }] = await as(agent, (q) => q(`select submit_inquiry('Strict Membre', '+225 07 00 44 55 66', 'Bonjour, test strict membre', p_consent => true) r`));
    const [i] = await sql(`select id, consent_text from inquiries where reference = $1`, [r.reference]);
    expect(i.consent_text).not.toMatch(/saisie interne/);
    const [{ b }] = await as(agent, (q) => q('select convert_inquiry_to_buyer($1) b', [i.id]));
    await as(admin, (q) => q('select anonymize_buyer($1)', [b]));
    expect(await sql(`select id from activity_logs where changes::text like '%Strict Membre%' or changes::text like '%44 55 66%'`)).toEqual([]);

    // Vente : commission alignée, offres closes, offres figées ; tableau de bord ; journal de publication.
    const [p] = await sql(`select p.id, p.owner_id from properties p where p.commercial_status = 'publie' and p.owner_id is not null
                            and not exists (select 1 from transactions t where t.property_id = p.id) limit 1`);
    const [t] = await as(agent, (q) => q(`insert into transactions (property_id, buyer_id, owner_id, commission_agreed) values ($1, $2, $3, 700000) returning id`, [p.id, b, p.owner_id]));
    const [n] = await as(agent, (q) => q(`insert into negotiations (transaction_id, offer_kind, from_party, amount) values ($1, 'offre', 'acheteur', 1000000) returning id`, [t.id]));
    await as(agent, (q) => q(`update transactions set status = 'vente_conclue', agreed_price = 1000000, concluded_date = current_date where id = $1`, [t.id]));
    expect((await sql('select status from negotiations where id = $1', [n.id]))[0].status).toBe('expiree');
    await expect(as(agent, (q) => q(`update negotiations set amount = 5 where id = $1`, [n.id]))).rejects.toThrow(/Dossier clôturé/);
    await as(admin, (q) => q(`update transactions set commission_agreed = 800000 where id = $1`, [t.id]));
    expect(await as(comptable, (q) => q(`select amount_expected::bigint a, status from financial_entries where transaction_id = $1`, [t.id]))).toEqual([{ a: '800000', status: 'exigible' }]);
    expect((await as(comptable, (q) => q('select dashboard_stats() d')))[0].d.finance.commissions_agreed_open).toBeDefined();
    await as(agent, (q) => q(`select log_event('depublication', 'properties', $1, 'Vendu')`, [p.id]));
    await as(admin, (q) => q(`update profiles set full_name = 'Agent Strict' where id = $1`, [agent.uid]));
  });

  it('les fonctions sensibles restent inaccessibles', async () => {
    await expect(as(agent, (q) => q(`select promote_to_admin('x@y.z')`))).rejects.toThrow(/permission denied/);
    await expect(as(anon, (q) => q(`select next_reference('BIEN')`))).rejects.toThrow(/permission denied/);
  });
});
