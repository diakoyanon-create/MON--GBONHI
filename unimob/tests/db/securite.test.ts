import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, as, closeDb, createUser, sql, type Who } from './helpers';

const PRIVATE_TABLES = [
  'profiles', 'owners', 'properties', 'property_photos', 'property_documents', 'document_checks',
  'buyers', 'commission_rules', 'mandates', 'inquiries', 'interactions', 'visits', 'transactions',
  'negotiations', 'financial_entries', 'payments', 'expenses', 'tasks', 'documents',
  'activity_logs', 'status_history', 'agency_settings', 'reference_counters',
];

let admin: Who, agent: Who, assistant: Who, comptable: Who, inactive: Who, noRole: Who;

beforeAll(async () => {
  admin = await createUser('admin');
  agent = await createUser('agent');
  assistant = await createUser('assistant');
  comptable = await createUser('comptable');
  inactive = await createUser('agent', false);
  noRole = await createUser(null);
});
afterAll(closeDb);

describe('RLS activée partout', () => {
  it('toutes les tables du schéma public ont RLS activé', async () => {
    const rows = await sql(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                            where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows.map((r) => r.relname)).toEqual([]);
  });
});

describe('Accès anonyme (clé publique du navigateur)', () => {
  for (const table of PRIVATE_TABLES) {
    it(`anon ne peut pas lire ${table}`, async () => {
      await expect(as(anon, (q) => q(`select * from public.${table} limit 1`))).rejects.toThrow(/permission denied/);
    });
  }

  it('anon ne peut pas insérer directement une demande', async () => {
    await expect(
      as(anon, (q) => q(`insert into inquiries (full_name, phone, message) values ('X', '0102030405', 'Bonjour test')`)),
    ).rejects.toThrow(/permission denied/);
  });

  it('anon lit uniquement le catalogue public restreint', async () => {
    const rows = await as(anon, (q) => q('select * from public_properties'));
    expect(rows.length).toBeGreaterThan(0);
    const cols = Object.keys(rows[0]);
    for (const forbidden of ['owner_id', 'latitude', 'longitude', 'assigned_to', 'created_by', 'unavailability_reason', 'verification_status']) {
      expect(cols).not.toContain(forbidden);
    }
    expect(rows.every((r) => ['publie', 'sous_negociation', 'reserve'].includes(r.commercial_status))).toBe(true);
  });

  it('anon lit les infos de vitrine mais pas les paramètres internes', async () => {
    const [info] = await as(anon, (q) => q('select * from public_agency_info'));
    expect(info.agency_name).toBeTruthy();
    expect(Object.keys(info)).not.toContain('data_retention_months');
  });

  it("aucune fonction SECURITY DEFINER sensible n'est exécutable par anon", async () => {
    const rows = await sql(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
       order by 1`);
    // Seules ces fonctions sont autorisées : elles ne renvoient que des booléens/rôle de l'appelant
    // ou valident strictement une demande publique.
    expect(rows.map((r) => r.proname).sort()).toEqual(
      ['can_finance', 'can_negotiate', 'can_sales', 'current_app_role', 'has_role', 'is_admin', 'is_staff', 'submit_inquiry'].sort(),
    );
  });

  it("anon ne peut pas se promouvoir administrateur", async () => {
    await expect(as(anon, (q) => q(`select promote_to_admin('x@y.z')`))).rejects.toThrow(/permission denied/);
  });
});

describe('Comptes sans rôle ou désactivés', () => {
  it('un compte inscrit sans rôle ne voit aucune donnée', async () => {
    for (const who of [noRole, inactive]) {
      const rows = await as(who, (q) => q('select id from properties'));
      expect(rows).toHaveLength(0);
      const buyers = await as(who, (q) => q('select id from buyers'));
      expect(buyers).toHaveLength(0);
    }
  });

  it('un compte sans rôle ne peut pas créer de bien', async () => {
    await expect(
      as(noRole, (q) => q(`insert into properties (property_type, title, city) values ('terrain', 'Pirate', 'Abidjan')`)),
    ).rejects.toThrow(/row-level security/);
  });

  it('un utilisateur ne peut pas modifier son propre rôle', async () => {
    await expect(
      as(noRole, (q) => q(`update profiles set role = 'admin', is_active = true where id = $1`, [noRole.uid])),
    ).rejects.toThrow(/administrateur/);
  });

  it("un agent ne peut pas s'attribuer le rôle admin", async () => {
    await expect(
      as(agent, (q) => q(`update profiles set role = 'admin' where id = $1`, [agent.uid])),
    ).rejects.toThrow(/administrateur/);
  });

  it("l'admin peut activer un compte, mais pas se retirer ses propres droits", async () => {
    const u = await createUser(null);
    await as(admin, (q) => q(`update profiles set role = 'assistant', is_active = true where id = $1`, [u.uid]));
    const [p] = await sql('select role, is_active from profiles where id = $1', [u.uid]);
    expect(p).toEqual({ role: 'assistant', is_active: true });
    await expect(
      as(admin, (q) => q(`update profiles set role = 'agent' where id = $1`, [admin.uid])),
    ).rejects.toThrow(/propres droits/);
  });

  it('promote_to_admin crée le premier administrateur (exécution serveur)', async () => {
    await sql(`insert into auth.users (email) values ('premier.admin@test.invalid')`);
    await sql(`select promote_to_admin('premier.admin@test.invalid')`);
    const [p] = await sql(`select role, is_active from profiles where email = 'premier.admin@test.invalid'`);
    expect(p).toEqual({ role: 'admin', is_active: true });
  });
});

describe('Matrice des rôles (moindre privilège)', () => {
  it("l'agent ne voit pas les finances", async () => {
    expect(await as(agent, (q) => q('select * from financial_entries'))).toHaveLength(0);
    expect(await as(agent, (q) => q('select * from expenses'))).toHaveLength(0);
    await expect(as(agent, (q) => q(`select finance_report(current_date - 30, current_date)`))).rejects.toThrow(/Accès refusé/);
  });

  it('le tableau de bord de l’agent ne contient pas de section finance', async () => {
    const [{ dashboard_stats: d }] = await as(agent, (q) => q('select dashboard_stats()'));
    expect(d.finance).toBeUndefined();
    expect(d.properties.total).toBeGreaterThan(0);
  });

  it('le comptable ne voit ni propriétaires ni prospects ni demandes', async () => {
    expect(await as(comptable, (q) => q('select * from owners'))).toHaveLength(0);
    expect(await as(comptable, (q) => q('select * from buyers'))).toHaveLength(0);
    expect(await as(comptable, (q) => q('select * from inquiries'))).toHaveLength(0);
    expect((await as(comptable, (q) => q('select * from expenses'))).length).toBeGreaterThan(0);
  });

  it("l'assistant lit les transactions mais ne peut pas en créer", async () => {
    expect((await as(assistant, (q) => q('select * from transactions'))).length).toBeGreaterThan(0);
    const [ref] = await sql(`select property_id, buyer_id, owner_id from transactions limit 1`);
    await expect(
      as(assistant, (q) => q(`insert into transactions (property_id, buyer_id, owner_id) values ($1, $2, $3)`, [ref.property_id, ref.buyer_id, ref.owner_id])),
    ).rejects.toThrow(/row-level security/);
  });

  it("seul l'admin peut supprimer un propriétaire", async () => {
    const [o] = await sql(`insert into owners (last_name, phone_primary) values ('A-SUPPRIMER', '0700000000') returning id`);
    const deletedByAgent = await as(agent, (q) => q('delete from owners where id = $1 returning id', [o.id]));
    expect(deletedByAgent).toHaveLength(0);
    const deletedByAdmin = await as(admin, (q) => q('delete from owners where id = $1 returning id', [o.id]));
    expect(deletedByAdmin).toHaveLength(1);
  });
});

describe("Journal d'activité", () => {
  it("n'est ni modifiable ni insérable par un utilisateur, même admin", async () => {
    await expect(as(admin, (q) => q(`insert into activity_logs (action, entity_type) values ('faux', 'x')`))).rejects.toThrow(/permission denied/);
    await expect(as(admin, (q) => q(`update activity_logs set summary = 'x'`))).rejects.toThrow(/permission denied/);
    await expect(as(admin, (q) => q(`delete from activity_logs`))).rejects.toThrow(/permission denied/);
  });

  it("est lisible par l'admin uniquement", async () => {
    expect((await as(admin, (q) => q('select * from activity_logs limit 5'))).length).toBeGreaterThan(0);
    expect(await as(agent, (q) => q('select * from activity_logs limit 5'))).toHaveLength(0);
  });

  it('enregistre les modifications de bien avec auteur et différences', async () => {
    const [p] = await sql(`select id from properties where commercial_status = 'a_verifier' limit 1`);
    await as(agent, (q) => q(`update properties set price_xof = price_xof + 1000 where id = $1`, [p.id]));
    const [log] = await sql(
      `select actor_id, changes from activity_logs where entity_id = $1 and action = 'update' order by id desc limit 1`, [p.id]);
    expect(log.actor_id).toBe(agent.uid);
    expect(log.changes.price_xof).toBeDefined();
    expect(log.changes.updated_at).toBeUndefined();
  });
});

describe('Stockage', () => {
  it('anon ne peut pas déposer de fichier', async () => {
    await expect(
      as(anon, (q) => q(`insert into storage.objects (bucket_id, name) values ('property-photos', 'x/y.jpg')`)),
    ).rejects.toThrow(/row-level security/);
  });

  it("l'agent peut déposer une photo et un document privé, pas un justificatif financier", async () => {
    await as(agent, (q) => q(`insert into storage.objects (bucket_id, name) values ('property-photos', 'p1/photo.jpg')`));
    await as(agent, (q) => q(`insert into storage.objects (bucket_id, name) values ('private-documents', 'p1/titre.pdf')`));
    await expect(
      as(agent, (q) => q(`insert into storage.objects (bucket_id, name) values ('finance-receipts', 'r/recu.pdf')`)),
    ).rejects.toThrow(/row-level security/);
  });

  it('le comptable ne lit pas les documents privés des biens', async () => {
    const rows = await as(comptable, (q) => q(`select * from storage.objects where bucket_id = 'private-documents'`));
    expect(rows).toHaveLength(0);
    const asAgent = await as(agent, (q) => q(`select * from storage.objects where bucket_id = 'private-documents'`));
    expect(asAgent.length).toBeGreaterThan(0);
  });

  it('le bucket documents est privé et les formats/tailles sont limités', async () => {
    const buckets = await sql('select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id');
    const byId = Object.fromEntries(buckets.map((b) => [b.id, b]));
    expect(byId['property-photos'].public).toBe(true);
    expect(byId['private-documents'].public).toBe(false);
    expect(byId['finance-receipts'].public).toBe(false);
    expect(Number(byId['property-photos'].file_size_limit)).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(byId['property-photos'].allowed_mime_types).not.toContain('application/pdf');
  });
});
