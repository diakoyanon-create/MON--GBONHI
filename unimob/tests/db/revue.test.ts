// Tests de non-régression des défauts confirmés par la relecture des corrections d'audit (migration 0008).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, as, closeDb, createUser, makePublishableProperty, sql, type Who } from './helpers';

let admin: Who, agent: Who, assistant: Who, comptable: Who;
beforeAll(async () => {
  admin = await createUser('admin');
  agent = await createUser('agent');
  assistant = await createUser('assistant');
  comptable = await createUser('comptable');
});
afterAll(closeDb);

let ipCounter = 0;
/** Envoi du formulaire public (anonyme ou membre connecté), depuis une adresse distincte. */
const submit = (who: Who, args: { name: string; phone: string; message?: string; email?: string | null }) =>
  as(who, async (q) => {
    await q(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-forwarded-for': `10.8.0.${++ipCounter}` })]);
    const [r] = await q(`select submit_inquiry(p_full_name => $1, p_phone => $2, p_message => $3, p_email => $4, p_consent => true) r`,
      [args.name, args.phone, args.message ?? 'Bonjour, je souhaite être rappelé.', args.email ?? null]);
    return r.r as { ok: boolean; reference: string };
  });

async function newBuyer(name = 'REVUE') {
  const [b] = await sql(`insert into buyers (last_name, phone) values ($1, '0712345670') returning id`, [name]);
  return b.id as string;
}
async function publishedProperty(price = 40000000) {
  const p = await makePublishableProperty({ price });
  await sql(`update properties set commercial_status = 'publie' where id = $1`, [p.propertyId]);
  return p;
}
const conclude = (who: Who, id: string, price = 40000000) =>
  as(who, (q) => q(`update transactions set status = 'vente_conclue', agreed_price = $2, concluded_date = current_date where id = $1`, [id, price]));
const commissionEntries = (trx: string) =>
  sql(`select amount_expected::bigint as a, status from financial_entries
        where transaction_id = $1 and entry_type = 'commission' and status <> 'annule' order by created_at, reference`, [trx]);

describe('Suppression d’un compte (auteur verrouillé)', () => {
  it('un compte qui a créé une tâche, une recette, un encaissement et un document peut être supprimé', async () => {
    const c = await createUser('comptable');
    const [t] = await as(c, (q) => q(`insert into tasks (title) values ('Tâche du comptable') returning id`));
    const [e] = await as(c, (q) => q(`insert into financial_entries (entry_type, amount_expected, status) values ('honoraires', 50000, 'exigible') returning id`));
    const [p] = await as(c, (q) => q(`insert into payments (financial_entry_id, paid_on, amount, method) values ($1, current_date, 20000, 'especes') returning id`, [e.id]));
    const [d] = await as(c, (q) => q(`insert into documents (doc_type, title) values ('recu', 'Reçu de test') returning id`));

    // Tant que le profil existe, l'auteur ne peut ni être effacé ni réattribué.
    await as(c, (q) => q(`update tasks set created_by = null where id = $1`, [t.id]));
    await as(c, (q) => q(`update financial_entries set created_by = $2 where id = $1`, [e.id, admin.uid]));
    expect((await sql('select created_by from tasks where id = $1', [t.id]))[0].created_by).toBe(c.uid);
    expect((await sql('select created_by from financial_entries where id = $1', [e.id]))[0].created_by).toBe(c.uid);

    // « Delete user » du tableau de bord Supabase (cascade auth.users → profiles).
    await sql('delete from auth.users where id = $1', [c.uid]);
    expect(await sql('select id from profiles where id = $1', [c.uid])).toHaveLength(0);
    expect((await sql('select created_by from tasks where id = $1', [t.id]))[0].created_by).toBeNull();
    expect((await sql('select created_by from financial_entries where id = $1', [e.id]))[0].created_by).toBeNull();
    expect((await sql('select created_by from payments where id = $1', [p.id]))[0].created_by).toBeNull();
    expect((await sql('select generated_by from documents where id = $1', [d.id]))[0].generated_by).toBeNull();
  });

  it('l’administrateur supprime le profil d’un agent par l’API (bien, propriétaire, dossier créés)', async () => {
    const a = await createUser('agent');
    const [o] = await as(a, (q) => q(`insert into owners (last_name, phone_primary) values ('SUPPR', '0700000077') returning id`));
    const [p] = await as(a, (q) => q(`insert into properties (property_type, title, city, owner_id) values ('terrain', 'Terrain supprimé', 'Abidjan', $1) returning id`, [o.id]));
    const b = await newBuyer();
    const [t] = await as(a, (q) => q(`insert into transactions (property_id, buyer_id, owner_id) values ($1, $2, $3) returning id`, [p.id, b, o.id]));
    await as(admin, (q) => q('delete from profiles where id = $1', [a.uid]));
    const [r] = await sql(`select (select created_by from owners where id = $1) o, (select created_by from properties where id = $2) p,
                                  (select created_by from transactions where id = $3) t`, [o.id, p.id, t.id]);
    expect(r).toEqual({ o: null, p: null, t: null });
  });
});

describe('Anonymisation : le journal est expurgé', () => {
  const leaks = (patterns: string[]) =>
    sql(`select action, entity_type, summary, changes from activity_logs
          where changes::text ilike any ($1) or summary ilike any ($1)`, [patterns]);

  it('prospect issu du site : plus aucune donnée personnelle dans le journal, événement conservé', async () => {
    const r = await submit(anon, {
      name: 'Awa Secrete Konan', phone: '+225 07 48 61 93 27', email: 'awa.konan@exemple.ci',
      message: 'Je cherche une villa a Cocody, appelez-moi',
    });
    const [i] = await sql('select id from inquiries where reference = $1', [r.reference]);
    const [{ b }] = await as(agent, (q) => q('select convert_inquiry_to_buyer($1) b', [i.id]));
    await as(agent, (q) => q(`update buyers set notes = 'Habite Cocody, CNI C0012345' where id = $1`, [b]));
    await as(agent, (q) => q(`insert into interactions (buyer_id, channel, summary, next_action) values ($1, 'appel', 'Mme Konan, CNI C0012345, rappeler au 07 48 61 93 27', 'Rappeler Mme Konan')`, [b]));
    const [x2] = await as(agent, (q) => q(`insert into interactions (buyer_id, channel, summary) values ($1, 'sms', 'SMS envoyé à Konan (supprimé ensuite)') returning id`, [b]));
    await as(admin, (q) => q('delete from interactions where id = $1', [x2.id]));
    const { propertyId } = await makePublishableProperty();
    await as(agent, (q) => q(`insert into visits (property_id, buyer_id, scheduled_at, report) values ($1, $2, now(), 'Visite avec Mme Konan, très intéressée')`, [propertyId, b]));
    await as(agent, (q) => q(`insert into tasks (title, buyer_id, description) values ('Relance prospect', $1, 'Appeler Konan au 07 48 61 93 27')`, [b]));

    const patterns = ['%Secrete%', '%Konan%', '%48 61 93 27%', '%awa.konan%', '%villa a Cocody%', '%C0012345%'];
    expect((await leaks(patterns)).length).toBeGreaterThan(0);
    await as(admin, (q) => q('select anonymize_buyer($1)', [b]));
    expect(await leaks(patterns)).toEqual([]);

    const [ev] = await sql(`select summary, changes from activity_logs where action = 'anonymisation' and entity_id = $1`, [b]);
    expect(ev.changes).toBeNull();
    expect(ev.summary).toMatch(/^ACH-/);
    // Les clés techniques restent lisibles (statut, rattachements).
    const [st] = await sql(`select changes from activity_logs where entity_type = 'buyers' and entity_id = $1 and changes ? 'status' order by id desc limit 1`, [b]);
    expect(st.changes.status).toEqual({ avant: 'a_contacter', apres: 'archive' });
  });

  it('propriétaire : fiche, échanges (même supprimés), contrôles de documents et tâches expurgés', async () => {
    const [o] = await as(agent, (q) => q(`insert into owners (last_name, first_names, phone_primary, email, address, notes)
      values ('ZOUMANA', 'Clarisse Unique', '+225 01 98 76 54 31', 'clarisse.zoumana@exemple.ci', 'Rue des Jardins, Riviera', 'Propriétaire discrète') returning id`));
    await as(agent, (q) => q(`insert into interactions (owner_id, channel, summary) values ($1, 'appel', 'Mme Zoumana rappellera au 01 98 76 54 31')`, [o.id]));
    const [x] = await as(agent, (q) => q(`insert into interactions (owner_id, channel, summary) values ($1, 'sms', 'Message à Zoumana') returning id`, [o.id]));
    await as(admin, (q) => q('delete from interactions where id = $1', [x.id]));
    await as(agent, (q) => q(`insert into document_checks (owner_id, doc_type, comment) values ($1, 'Pièce d''identité', 'CNI de Clarisse Zoumana n° C0098765')`, [o.id]));
    await as(agent, (q) => q(`insert into tasks (title, owner_id, description) values ('Relance propriétaire', $1, 'Écrire à clarisse.zoumana@exemple.ci')`, [o.id]));

    const patterns = ['%Zoumana%', '%Clarisse%', '%98 76 54 31%', '%Riviera%', '%discrète%', '%C0098765%'];
    expect((await leaks(patterns)).length).toBeGreaterThan(0);
    await as(admin, (q) => q('select anonymize_owner($1)', [o.id]));
    expect(await leaks(patterns)).toEqual([]);
    const [ev] = await sql(`select count(*)::int n from activity_logs where action = 'anonymisation' and entity_id = $1`, [o.id]);
    expect(ev.n).toBe(1);
  });

  it('les champs libres des tâches et des contrôles de documents sont effacés dans les tables', async () => {
    const b = await newBuyer('TACHE');
    await as(agent, (q) => q(`insert into tasks (title, buyer_id, next_action) values ('Rappeler Mme Tache Unique', $1, 'Appeler 0799887766')`, [b]));
    const [o] = await as(agent, (q) => q(`insert into owners (last_name, phone_primary) values ('DOCREF', '0700000088') returning id`));
    await as(agent, (q) => q(`insert into document_checks (owner_id, doc_type, doc_reference) values ($1, 'Pièce d''identité', 'C0012345')`, [o.id]));
    await as(agent, (q) => q(`insert into tasks (title, owner_id, next_action) values ('Visite chez M. Docref', $1, 'Écrire au 0700000088')`, [o.id]));
    await as(admin, (q) => q('select anonymize_buyer($1)', [b]));
    await as(admin, (q) => q('select anonymize_owner($1)', [o.id]));
    const tasks = await sql(`select title, next_action, description, result from tasks where buyer_id = $1 or owner_id = $2`, [b, o.id]);
    expect(tasks).toHaveLength(2);
    for (const t of tasks) expect(t).toEqual({ title: 'Tâche (personne anonymisée)', next_action: null, description: null, result: null });
    const [dc] = await sql('select doc_reference, comment from document_checks where owner_id = $1', [o.id]);
    expect(dc).toEqual({ doc_reference: null, comment: null });
    expect(await leaks(['%0799887766%', '%C0012345%', '%Tache Unique%', '%Docref%'])).toEqual([]);
  });
});

describe('Preuve de consentement', () => {
  it('un membre connecté qui envoie le formulaire public garde le texte accepté sur le site', async () => {
    const [{ txt }] = await sql(`select inquiry_consent_text txt from agency_settings where id = 1`);
    for (const who of [anon, agent]) {
      const r = await submit(who, { name: 'Client Public', phone: `+225 07 31 00 00 0${ipCounter % 10}` });
      const [i] = await sql('select consent_text, source from inquiries where reference = $1', [r.reference]);
      expect(i).toEqual({ consent_text: txt, source: 'site_web' });
    }
  });

  it('une saisie de l’équipe est attribuée (nom et courriel), figée, et ne passe jamais pour une demande du site', async () => {
    await sql(`update profiles set full_name = 'Awa Agent' where id = $1`, [agent.uid]);
    const [{ email }] = await sql('select email from profiles where id = $1', [agent.uid]);
    await expect(as(agent, (q) => q(`insert into inquiries (full_name, phone, message, source, consent) values ('Faux Site', '0700000091', 'Saisie maquillée', 'site_web', true)`))).rejects.toThrow(/Site web/);
    await expect(as(agent, (q) => q(`insert into inquiries (full_name, phone, message, consent) values ('Faux Site', '0700000091', 'Source par défaut', true)`))).rejects.toThrow(/Site web/);

    const [i] = await as(assistant, (q) => q(`insert into inquiries (full_name, phone, message, source, consent) values ('Appel Tel', '0700000092', 'Appel entrant test', 'telephone', true) returning id, consent_text`));
    const [{ aemail }] = await sql('select email aemail from profiles where id = $1', [assistant.uid]);
    expect(i.consent_text).toMatch(/^Accord déclaré par .* le \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} \(saisie interne\)$/);
    expect(i.consent_text).toContain(aemail);

    await as(agent, (q) => q(`update inquiries set consent_text = 'J''accepte que l''agence utilise ces informations (formulaire du site)' where id = $1`, [i.id]));
    await as(agent, (q) => q(`update inquiries set consent = true, consent_text = 'Texte libre' where id = $1`, [i.id]));
    await expect(as(agent, (q) => q(`update inquiries set source = 'site_web' where id = $1`, [i.id]))).rejects.toThrow(/Site web/);
    const [after] = await sql('select consent_text, source from inquiries where id = $1', [i.id]);
    expect(after).toEqual({ consent_text: i.consent_text, source: 'telephone' });

    // Retrait puis nouvel accord : nouvelle attribution, au nom (et courriel) de celui qui le déclare.
    await as(agent, (q) => q(`update inquiries set consent = false where id = $1`, [i.id]));
    expect((await sql('select consent_text from inquiries where id = $1', [i.id]))[0].consent_text).toBeNull();
    const [re] = await as(agent, (q) => q(`update inquiries set consent = true, consent_text = 'Texte libre' where id = $1 returning consent_text`, [i.id]));
    expect(re.consent_text).toMatch(new RegExp(`^Accord déclaré par Awa Agent \\(${email.replace(/[.]/g, '\\.')}\\) le .* \\(saisie interne\\)$`));

    // Une demande du site reste modifiable sur ses autres colonnes, sans perdre sa preuve.
    const r = await submit(anon, { name: 'Site Modifiable', phone: '+225 07 32 00 00 01' });
    const [web] = await as(agent, (q) => q(`update inquiries set status = 'en_cours', consent_text = 'Réécrit' where reference = $1 returning consent_text, source`, [r.reference]));
    const [{ txt }] = await sql(`select inquiry_consent_text txt from agency_settings where id = 1`);
    expect(web).toEqual({ consent_text: txt, source: 'site_web' });
  });

  it('la date d’accord d’un prospect est fixée par la base (ni antidatée, ni future, ni réécrite)', async () => {
    const [b] = await as(agent, (q) => q(`insert into buyers (last_name, phone, consent_contact, consent_marketing, consent_date) values ('DATE', '0701010101', true, true, '2019-03-01') returning id, consent_date`));
    const recent = (d: Date) => Math.abs(Date.now() - new Date(d).getTime()) < 60_000;
    expect(recent(b.consent_date)).toBe(true);
    await as(agent, (q) => q(`update buyers set consent_date = '2024-01-01' where id = $1`, [b.id]));
    expect((await sql('select consent_date from buyers where id = $1', [b.id]))[0].consent_date).toEqual(b.consent_date);
    const [f] = await as(agent, (q) => q(`insert into buyers (last_name, phone, consent_contact, consent_date) values ('FUTUR', '0701010102', true, '2099-01-01') returning id, consent_date`));
    expect(recent(f.consent_date)).toBe(true);
    const [n] = await as(agent, (q) => q(`insert into buyers (last_name, phone, consent_date) values ('SANS', '0701010103', '2020-01-01') returning id, consent_date`));
    expect(n.consent_date).toBeNull();
    const [n2] = await as(agent, (q) => q(`update buyers set consent_contact = true, consent_date = '2020-01-01' where id = $1 returning consent_date`, [n.id]));
    expect(recent(n2.consent_date)).toBe(true);
    // Session serveur (reprise de données) : date passée acceptée, date future ramenée à maintenant.
    const [s] = await sql(`insert into buyers (last_name, phone, consent_contact, consent_date) values ('IMPORT', '0701010104', true, '2099-01-01') returning consent_date`);
    expect(recent(s.consent_date)).toBe(true);
  });

  it('la conversion d’une demande en prospect fonctionne toujours', async () => {
    const r = await submit(anon, { name: 'Conversion Revue', phone: '+225 07 33 00 00 01', email: 'conversion@exemple.ci' });
    const [i] = await sql('select id from inquiries where reference = $1', [r.reference]);
    const [{ b }] = await as(agent, (q) => q('select convert_inquiry_to_buyer($1) b', [i.id]));
    const [buyer] = await sql('select consent_contact, consent_date from buyers where id = $1', [b]);
    expect(buyer.consent_contact).toBe(true);
    expect(buyer.consent_date).not.toBeNull();
    const [inq] = await sql('select status, buyer_id, source from inquiries where id = $1', [i.id]);
    expect(inq).toEqual({ status: 'converti', buyer_id: b, source: 'site_web' });
  });

  it('le prospect issu d’une demande du site garde la date de l’envoi du formulaire, que l’équipe ne peut pas modifier', async () => {
    const r = await submit(anon, { name: 'Date Formulaire', phone: '+225 07 33 00 00 02' });
    // Demande reçue il y a trois jours (date fixée en session serveur, comme un envoi réel).
    await sql(`update inquiries set created_at = now() - interval '3 days' where reference = $1`, [r.reference]);
    const [i] = await sql('select id, created_at from inquiries where reference = $1', [r.reference]);
    // Un membre ne peut ni antidater ni modifier la date de réception.
    await as(agent, (q) => q(`update inquiries set created_at = '2019-01-01' where id = $1`, [i.id]));
    expect((await sql('select created_at from inquiries where id = $1', [i.id]))[0].created_at).toEqual(i.created_at);
    const [own] = await as(agent, (q) => q(`insert into inquiries (full_name, phone, message, source, consent, created_at) values ('Appel Date', '0700000093', 'Appel du jour', 'telephone', true, '2019-01-01') returning created_at`));
    expect(Math.abs(Date.now() - new Date(own.created_at).getTime())).toBeLessThan(60_000);

    const [{ b }] = await as(agent, (q) => q('select convert_inquiry_to_buyer($1) b', [i.id]));
    const [buyer] = await sql('select consent_date from buyers where id = $1', [b]);
    expect(buyer.consent_date).toEqual(i.created_at);
  });
});

describe('Commission d’un dossier conclu', () => {
  it('une commission répartie sur deux écritures n’est pas multipliée quand la commission convenue change', async () => {
    const { propertyId, ownerId } = await publishedProperty();
    const [t] = await as(agent, async (q) => q(`insert into transactions (property_id, buyer_id, owner_id, commission_agreed) values ($1, $2, $3, 2000000) returning id`, [propertyId, await newBuyer(), ownerId]));
    for (const part of ['Part vendeur', 'Part acheteur']) {
      await as(comptable, (q) => q(`insert into financial_entries (entry_type, transaction_id, amount_expected, status, description) values ('commission', $1, 1000000, 'prevu', $2)`, [t.id, part]));
    }
    await conclude(agent, t.id);
    expect(await commissionEntries(t.id)).toEqual([{ a: '1000000', status: 'exigible' }, { a: '1000000', status: 'exigible' }]);
    await as(admin, (q) => q(`update transactions set commission_agreed = 2400000 where id = $1`, [t.id]));
    expect(await commissionEntries(t.id)).toEqual([{ a: '1000000', status: 'exigible' }, { a: '1000000', status: 'exigible' }]);
    const [c] = await as(comptable, (q) => q('select commission_due::bigint d from transaction_commissions where transaction_id = $1', [t.id]));
    expect(c.d).toBe('2000000');
  });

  it('l’écriture unique ne descend jamais sous l’encaissé', async () => {
    const { propertyId, ownerId } = await publishedProperty();
    const [t] = await as(agent, async (q) => q(`insert into transactions (property_id, buyer_id, owner_id, commission_agreed) values ($1, $2, $3, 1000000) returning id`, [propertyId, await newBuyer(), ownerId]));
    await conclude(agent, t.id);
    const [fe] = await sql(`select id from financial_entries where transaction_id = $1`, [t.id]);
    await as(comptable, (q) => q(`insert into payments (financial_entry_id, paid_on, amount, method) values ($1, current_date, 500000, 'virement')`, [fe.id]));
    await as(admin, (q) => q(`update transactions set commission_agreed = 300000 where id = $1`, [t.id]));
    expect(await commissionEntries(t.id)).toEqual([{ a: '500000', status: 'encaisse' }]);
    await as(admin, (q) => q(`update transactions set commission_agreed = 800000 where id = $1`, [t.id]));
    expect(await commissionEntries(t.id)).toEqual([{ a: '800000', status: 'partiel' }]);
  });

  it('à la conclusion, l’écriture prévue est alignée sur la commission convenue plus tôt', async () => {
    const { propertyId, ownerId } = await publishedProperty(50000000);
    const [t] = await as(agent, async (q) => q(`insert into transactions (property_id, buyer_id, owner_id) values ($1, $2, $3) returning id`, [propertyId, await newBuyer(), ownerId]));
    await as(comptable, (q) => q(`insert into financial_entries (entry_type, transaction_id, amount_expected, status) values ('commission', $1, 2500000, 'prevu')`, [t.id]));
    await as(agent, (q) => q(`update transactions set commission_agreed = 1500000 where id = $1`, [t.id]));
    await conclude(agent, t.id, 48000000);
    expect(await commissionEntries(t.id)).toEqual([{ a: '1500000', status: 'exigible' }]);
    const [c] = await as(comptable, (q) => q('select commission_due::bigint d from transaction_commissions where transaction_id = $1', [t.id]));
    expect(c.d).toBe('1500000');
  });

  it('une écriture prévue à 0 FCFA devient exigible au montant convenu, ou à l’estimation à défaut', async () => {
    const a = await publishedProperty();
    const [t1] = await as(agent, async (q) => q(`insert into transactions (property_id, buyer_id, owner_id, commission_agreed) values ($1, $2, $3, 900000) returning id`, [a.propertyId, await newBuyer(), a.ownerId]));
    await as(comptable, (q) => q(`insert into financial_entries (entry_type, transaction_id, amount_expected, status, notes) values ('commission', $1, 0, 'prevu', 'À compléter')`, [t1.id]));
    await conclude(agent, t1.id);
    expect(await commissionEntries(t1.id)).toEqual([{ a: '900000', status: 'exigible' }]);

    const p = await publishedProperty();
    const [rule] = await sql(`select id from commission_rules where calc_type = 'pourcentage' limit 1`);
    const [t2] = await as(agent, async (q) => q(`insert into transactions (property_id, buyer_id, owner_id, commission_rule_id) values ($1, $2, $3, $4) returning id`, [p.propertyId, await newBuyer(), p.ownerId, rule.id]));
    await as(comptable, (q) => q(`insert into financial_entries (entry_type, transaction_id, amount_expected, status) values ('commission', $1, 0, 'prevu')`, [t2.id]));
    await conclude(agent, t2.id, 38000000);
    expect(await commissionEntries(t2.id)).toEqual([{ a: '1900000', status: 'exigible' }]); // 5 % de 38 M
    const [fe] = await sql(`select notes from financial_entries where transaction_id = $1`, [t2.id]);
    expect(fe.notes).toMatch(/à confirmer/);
  });

  it('à la vente, les offres en attente des dossiers clos (concurrents, abandonnés et conclu) expirent', async () => {
    const { propertyId, ownerId } = await publishedProperty();
    const [t1] = await as(agent, async (q) => q(`insert into transactions (property_id, buyer_id, owner_id) values ($1, $2, $3) returning id`, [propertyId, await newBuyer(), ownerId]));
    const [t2] = await as(agent, async (q) => q(`insert into transactions (property_id, buyer_id, owner_id) values ($1, $2, $3) returning id`, [propertyId, await newBuyer(), ownerId]));
    const [t3] = await as(agent, async (q) => q(`insert into transactions (property_id, buyer_id, owner_id) values ($1, $2, $3) returning id`, [propertyId, await newBuyer(), ownerId]));
    for (const t of [t1, t2, t3]) {
      await as(agent, (q) => q(`insert into negotiations (transaction_id, offer_kind, from_party, amount) values ($1, 'offre', 'acheteur', 35000000)`, [t.id]));
    }
    await as(agent, (q) => q(`update transactions set status = 'abandonnee', abandon_reason = 'Désistement' where id = $1`, [t3.id]));
    expect((await sql('select status from negotiations where transaction_id = $1', [t3.id]))[0].status).toBe('expiree');
    await as(agent, (q) => q(`insert into negotiations (transaction_id, offer_kind, from_party, amount, status) values ($1, 'contre_offre', 'vendeur', 39000000, 'acceptee')`, [t1.id]));
    await conclude(agent, t1.id, 39000000);
    const offers = await sql(`select transaction_id, status from negotiations where transaction_id = any ($1) order by status`, [[t1.id, t2.id]]);
    expect(offers.filter((o) => o.transaction_id === t2.id).map((o) => o.status)).toEqual(['expiree']);
    expect(offers.filter((o) => o.transaction_id === t1.id).map((o) => o.status).sort()).toEqual(['acceptee', 'expiree']);
  });
});

describe('Changement de propriétaire', () => {
  it('refusé si le mandat ou le dossier en cours concerne un autre propriétaire, même sans propriétaire initial', async () => {
    const [o1] = await sql(`insert into owners (last_name, phone_primary) values ('O-UN', '0702020201') returning id`);
    const [o2] = await sql(`insert into owners (last_name, phone_primary) values ('O-DEUX', '0702020202') returning id`);
    const [p] = await as(agent, (q) => q(`insert into properties (property_type, title, city) values ('maison', 'Bien sans propriétaire', 'Abidjan') returning id`));
    await as(agent, (q) => q(`insert into mandates (owner_id, property_id, signed_date, status) values ($1, $2, current_date, 'actif')`, [o1.id, p.id]));
    await expect(as(agent, (q) => q(`update properties set owner_id = $2 where id = $1`, [p.id, o2.id]))).rejects.toThrow(/Changement de propriétaire impossible/);
    // Le propriétaire du mandat, lui, peut être renseigné.
    await as(agent, (q) => q(`update properties set owner_id = $2 where id = $1`, [p.id, o1.id]));

    const [p2] = await as(agent, (q) => q(`insert into properties (property_type, title, city) values ('maison', 'Bien sans propriétaire 2', 'Abidjan') returning id`));
    await as(agent, async (q) => q(`insert into transactions (property_id, buyer_id, owner_id) values ($1, $2, $3)`, [p2.id, await newBuyer(), o1.id]));
    await expect(as(agent, (q) => q(`update properties set owner_id = $2 where id = $1`, [p2.id, o2.id]))).rejects.toThrow(/Changement de propriétaire impossible/);
  });

  it('après la vente et le changement de propriétaire, le dossier clôturé reste modifiable (notes, administrateur) et son auteur supprimable', async () => {
    const a = await createUser('agent');
    const { propertyId, ownerId } = await publishedProperty();
    const [t] = await as(a, async (q) => q(`insert into transactions (property_id, buyer_id, owner_id, commission_agreed) values ($1, $2, $3, 1000000) returning id`, [propertyId, await newBuyer(), ownerId]));
    await conclude(a, t.id);
    const [acq] = await sql(`insert into owners (last_name, phone_primary) values ('ACQUEREUR', '0702020203') returning id`);
    await as(agent, (q) => q(`update properties set owner_id = $2 where id = $1`, [propertyId, acq.id]));
    await as(agent, (q) => q(`update transactions set notes = 'Acte remis' where id = $1`, [t.id]));
    await as(admin, (q) => q(`update transactions set commission_agreed = 1200000 where id = $1`, [t.id]));
    // Un changement de vendeur reste contrôlé.
    const [autre] = await sql(`insert into owners (last_name, phone_primary) values ('AUTRE', '0702020204') returning id`);
    await expect(as(admin, (q) => q(`update transactions set owner_id = $2 where id = $1`, [t.id, autre.id]))).rejects.toThrow(/vendeur/);
    await sql('delete from auth.users where id = $1', [a.uid]);
    expect((await sql('select created_by from transactions where id = $1', [t.id]))[0].created_by).toBeNull();
  });
});

describe('Changement de propriétaire : réouverture', () => {
  it('une vente ne peut pas être rouverte au nom de l’ancien propriétaire du bien', async () => {
    const { propertyId, ownerId } = await publishedProperty();
    const [t] = await as(agent, async (q) => q(`insert into transactions (property_id, buyer_id, owner_id) values ($1, $2, $3) returning id`, [propertyId, await newBuyer(), ownerId]));
    await conclude(agent, t.id);
    const [acq] = await sql(`insert into owners (last_name, phone_primary) values ('ACQUEREUR-R', '0702020205') returning id`);
    await as(agent, (q) => q(`update properties set owner_id = $2 where id = $1`, [propertyId, acq.id]));
    await expect(as(admin, (q) => q(`update transactions set status = 'dossier_en_cours' where id = $1`, [t.id]))).rejects.toThrow(/vendeur/);
    // Propriétaire d'origine rétabli : la réouverture redevient possible.
    await as(admin, (q) => q(`update properties set owner_id = $2 where id = $1`, [propertyId, ownerId]));
    await as(admin, (q) => q(`update transactions set status = 'dossier_en_cours' where id = $1`, [t.id]));
    expect((await sql('select status from transactions where id = $1', [t.id]))[0].status).toBe('dossier_en_cours');
  });
});

describe('Tableau de bord', () => {
  it('la commission convenue des dossiers ouverts est comptée une fois par bien', async () => {
    const stat = async () => Number((await as(comptable, (q) => q('select dashboard_stats() d')))[0].d.finance.commissions_agreed_open);
    const before = await stat();
    const { propertyId, ownerId } = await publishedProperty();
    for (let i = 0; i < 2; i++) {
      await as(agent, async (q) => q(`insert into transactions (property_id, buyer_id, owner_id, commission_agreed) values ($1, $2, $3, 1500000)`, [propertyId, await newBuyer(), ownerId]));
    }
    expect((await stat()) - before).toBe(1500000);
  });
});

describe('Identité dans le journal', () => {
  it('seul l’administrateur modifie le nom d’un compte ; création et synchronisation du courriel inchangées', async () => {
    await expect(as(comptable, (q) => q(`update profiles set full_name = 'Kouassi Admin' where id = $1`, [comptable.uid]))).rejects.toThrow(/nom/);
    await as(comptable, (q) => q(`update profiles set phone = '+225 07 00 00 00 01' where id = $1`, [comptable.uid]));
    await as(admin, (q) => q(`update profiles set full_name = 'Compta Revue' where id = $1`, [comptable.uid]));
    expect((await sql('select full_name from profiles where id = $1', [comptable.uid]))[0].full_name).toBe('Compta Revue');

    const [u] = await sql(`insert into auth.users (email, raw_user_meta_data) values ('invite.revue@test.invalid', '{"full_name": "Invité Revue"}') returning id`);
    expect(await sql('select full_name, email, role from profiles where id = $1', [u.id])).toEqual([{ full_name: 'Invité Revue', email: 'invite.revue@test.invalid', role: null }]);
    await sql(`update auth.users set email = 'invite.revue2@test.invalid' where id = $1`, [u.id]);
    expect((await sql('select email from profiles where id = $1', [u.id]))[0].email).toBe('invite.revue2@test.invalid');
    // Page Utilisateurs : l'administrateur attribue rôle et activation.
    await as(admin, (q) => q(`update profiles set role = 'assistant', is_active = true where id = $1`, [u.id]));
  });

  it('publication et dépublication ne sont déclarées que par un membre commercial, sur un bien existant', async () => {
    const { propertyId } = await makePublishableProperty();
    await expect(as(comptable, (q) => q(`select log_event('publication', 'properties', $1, 'X → publie')`, [propertyId]))).rejects.toThrow(/Accès refusé/);
    await expect(as(agent, (q) => q(`select log_event('publication', 'properties', '11111111-1111-1111-1111-111111111111', 'X → publie')`))).rejects.toThrow(/Accès refusé/);
    await expect(as(agent, (q) => q(`select log_event('depublication', 'owners', $1, 'X → retire')`, [propertyId]))).rejects.toThrow(/Accès refusé/);
    await as(agent, (q) => q(`select log_event('publication', 'properties', $1, 'BIEN → publie')`, [propertyId]));
    await as(comptable, (q) => q(`select log_event('export_csv', 'financial_entries', null, 'Export')`));
  });
});

describe('Dossier clôturé : offres figées', () => {
  it('un agent ne modifie ni n’ajoute d’offre sur une vente conclue ; notes et administrateur autorisés', async () => {
    const { propertyId, ownerId } = await publishedProperty();
    const [t] = await as(agent, async (q) => q(`insert into transactions (property_id, buyer_id, owner_id) values ($1, $2, $3) returning id`, [propertyId, await newBuyer(), ownerId]));
    const [n] = await as(agent, (q) => q(`insert into negotiations (transaction_id, offer_kind, from_party, amount, status) values ($1, 'offre', 'acheteur', 38000000, 'acceptee') returning id`, [t.id]));
    await conclude(agent, t.id, 38000000);
    await expect(as(agent, (q) => q(`update negotiations set amount = 1000 where id = $1`, [n.id]))).rejects.toThrow(/Dossier clôturé/);
    await expect(as(agent, (q) => q(`insert into negotiations (transaction_id, offer_kind, from_party, amount, status) values ($1, 'offre', 'acheteur', 5, 'acceptee')`, [t.id]))).rejects.toThrow(/Dossier clôturé/);
    await as(agent, (q) => q(`update negotiations set notes = 'Offre signée' where id = $1`, [n.id]));
    await as(admin, (q) => q(`update negotiations set conditions = 'Prêt obtenu' where id = $1`, [n.id]));
    const [r] = await sql('select amount::bigint a, notes, conditions from negotiations where id = $1', [n.id]);
    expect(r).toEqual({ a: '38000000', notes: 'Offre signée', conditions: 'Prêt obtenu' });
  });

  it('pas de déplacement d’une offre depuis un dossier annulé', async () => {
    const { propertyId, ownerId } = await publishedProperty();
    const [t1] = await as(agent, async (q) => q(`insert into transactions (property_id, buyer_id, owner_id) values ($1, $2, $3) returning id`, [propertyId, await newBuyer(), ownerId]));
    const [t2] = await as(agent, async (q) => q(`insert into transactions (property_id, buyer_id, owner_id) values ($1, $2, $3) returning id`, [propertyId, await newBuyer(), ownerId]));
    const [n] = await as(agent, (q) => q(`insert into negotiations (transaction_id, offer_kind, from_party, amount) values ($1, 'offre', 'acheteur', 30000000) returning id`, [t1.id]));
    await as(agent, (q) => q(`update transactions set status = 'annulee', abandon_reason = 'Erreur de saisie' where id = $1`, [t1.id]));
    await expect(as(agent, (q) => q(`update negotiations set transaction_id = $2 where id = $1`, [n.id, t2.id]))).rejects.toThrow(/Dossier clôturé/);
  });
});

describe('Droits complémentaires (migration 0008)', () => {
  it('unaccent est exécutable par le visiteur et l’équipe ; aucune séquence n’est accessible au visiteur', async () => {
    const [r] = await sql(`select has_function_privilege('anon', 'extensions.unaccent(text)', 'execute') a,
                                  has_function_privilege('authenticated', 'extensions.unaccent(text)', 'execute') u,
                                  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                    where n.nspname = 'public' and c.relkind = 'S'
                                      and (has_sequence_privilege('anon', c.oid, 'usage') or has_sequence_privilege('anon', c.oid, 'update'))) s`);
    expect(r).toEqual({ a: true, u: true, s: 0 });
  });
});

describe('Fonctions internes', () => {
  it('les fonctions ajoutées par la migration 0008 ne sont pas appelables via l’API', async () => {
    for (const f of ['log_mask(jsonb)', 'log_mask_summary(text)', 'log_scrub_person(text, uuid, text[])', 'align_commission_entry(uuid, numeric)', 'tg_negotiation_closed()']) {
      const [r] = await sql(`select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') b`, [`public.${f}`]);
      expect(r).toEqual({ a: false, b: false });
    }
  });
});
