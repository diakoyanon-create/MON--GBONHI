// Tests de non-régression des défauts confirmés par l'audit du 10 octobre 2026 (migration 0007).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, as, closeDb, createUser, makePublishableProperty, sql, type Who } from './helpers';

let admin: Who, agent: Who, agent2: Who, assistant: Who, comptable: Who;
beforeAll(async () => {
  admin = await createUser('admin');
  agent = await createUser('agent');
  agent2 = await createUser('agent');
  assistant = await createUser('assistant');
  comptable = await createUser('comptable');
});
afterAll(closeDb);

const OPEN = `('negociation','offre_en_attente','offre_acceptee_sous_conditions','dossier_en_cours')`;
let ipCounter = 0;
const submitFrom = (ip: string, args: Record<string, unknown>) =>
  as(anon, async (q) => {
    await q(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-forwarded-for': ip })]);
    const [r] = await q(`select submit_inquiry(p_full_name => $1, p_phone => $2, p_message => $3, p_property_reference => $4, p_consent => true) r`,
      [args.name ?? 'Test Correction', args.phone ?? `+225 07 77 ${String(++ipCounter).padStart(2, '0')} 00 00`, 'Bonjour, est-ce disponible ?', args.ref ?? null]);
    return r.r;
  });

async function publishedProperty(price = 40000000) {
  const p = await makePublishableProperty({ price });
  await sql(`update properties set commercial_status = 'publie' where id = $1`, [p.propertyId]);
  return p;
}
async function newBuyer() {
  const [b] = await sql(`insert into buyers (last_name, phone) values ('CORR', '0712345678') returning id`);
  return b.id as string;
}
const isPublic = async (id: string) => (await as(anon, (q) => q('select id from public_properties where id = $1', [id]))).length === 1;

describe('Vues publiques en lecture seule', () => {
  it('anon ne peut ni modifier ni supprimer les infos de l’agence via la vue', async () => {
    await expect(as(anon, (q) => q(`update public_agency_info set phone = '+225 HACK'`))).rejects.toThrow(/permission denied/);
    await expect(as(anon, (q) => q(`delete from public_agency_info`))).rejects.toThrow(/permission denied/);
    await expect(as(agent, (q) => q(`update public_agency_info set agency_name = 'X'`))).rejects.toThrow(/permission denied/);
    await expect(as(anon, (q) => q(`update public_properties set price_xof = 1`))).rejects.toThrow(/permission denied/);
    await expect(as(comptable, (q) => q(`delete from transaction_commissions`))).rejects.toThrow(/permission denied|cannot delete from view/);
  });
});

describe('Références', () => {
  it('le format automatique est réservé et une référence manuelle ne bloque plus le compteur', async () => {
    const [{ next }] = await sql(`select 'BIEN-' || extract(year from now())::int || '-' || lpad((coalesce((select last_value from reference_counters where prefix='BIEN' and year = extract(year from now())::int), 0) + 1)::text, 5, '0') as next`);
    await expect(as(agent, (q) => q(`insert into properties (reference, property_type, title, city) values ($1, 'terrain', 'Réf piège', 'Abidjan')`, [next]))).rejects.toThrow(/réservé aux références automatiques/);
    // Cas hérité : la valeur existe déjà (données importées) — la génération la saute au lieu d'échouer.
    await sql(`alter table properties disable trigger properties_reference`);
    await sql(`insert into properties (reference, property_type, title, city) values ($1, 'terrain', 'Occupe', 'Abidjan')`, [next]);
    await sql(`alter table properties enable trigger properties_reference`);
    const [p] = await as(agent, (q) => q(`insert into properties (property_type, title, city) values ('terrain', 'Après collision', 'Abidjan') returning reference`));
    expect(p.reference).toMatch(/^BIEN-\d{4}-\d{5}$/);
    expect(p.reference).not.toBe(next);
  });

  it('seul l’administrateur modifie une référence', async () => {
    const [p] = await as(agent, (q) => q(`insert into properties (property_type, title, city) values ('terrain', 'Réf fixe', 'Abidjan') returning id`));
    await expect(as(agent, (q) => q(`update properties set reference = 'AUTRE-REF' where id = $1`, [p.id]))).rejects.toThrow(/administrateur/);
    await as(admin, (q) => q(`update properties set reference = 'agence-001' where id = $1`, [p.id]));
    const [r] = await sql('select reference from properties where id = $1', [p.id]);
    expect(r.reference).toBe('AGENCE-001');
  });
});

describe('Demandes publiques', () => {
  it('la limite par numéro résiste aux envois simultanés', async () => {
    const phone = '+225 05 99 99 99 01';
    const results = await Promise.allSettled([1, 2, 3, 4].map((i) => submitFrom(`10.0.0.${i}`, { phone })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('l’empreinte réseau n’est lisible par personne via l’API', async () => {
    await expect(as(admin, (q) => q(`select * from private.inquiry_throttle`))).rejects.toThrow(/permission denied/);
    await expect(as(admin, (q) => q(`select * from private.app_secret`))).rejects.toThrow(/permission denied/);
  });

  it('une demande sur un bien fictif n’y est pas rattachée', async () => {
    const [demo] = await sql(`select reference from properties where is_demo and commercial_status = 'publie' limit 1`);
    const r = await submitFrom('10.0.1.1', { ref: demo.reference });
    const [i] = await sql('select property_id from inquiries where reference = $1', [r.reference]);
    expect(i.property_id).toBeNull();
  });

  it('une demande saisie par l’équipe trace qui a déclaré l’accord ; la date de consentement du prospect est automatique', async () => {
    const [i] = await as(agent, (q) => q(`insert into inquiries (full_name, phone, message, source, consent) values ('Appel Test', '0700000099', 'Appel entrant test', 'telephone', true) returning consent_text`));
    expect(i.consent_text).toMatch(/^Accord déclaré par .* \(saisie interne\)$/);
    const [b] = await as(agent, (q) => q(`insert into buyers (last_name, phone, consent_contact) values ('CONSENT', '0700000098', true) returning id, consent_date`));
    expect(b.consent_date).not.toBeNull();
    const [b2] = await as(agent, (q) => q(`update buyers set consent_contact = false where id = $1 returning consent_date`, [b.id]));
    expect(b2.consent_date).toBeNull();
  });
});

describe('Publication contrôlée en permanence', () => {
  it('un mandat échu ou signé dans le futur ne peut pas être actif', async () => {
    const { propertyId, ownerId } = await makePublishableProperty();
    await sql(`update mandates set status = 'cloture' where property_id = $1`, [propertyId]);
    await expect(as(agent, (q) => q(`insert into mandates (owner_id, property_id, signed_date, end_date, status) values ($1, $2, '2025-01-01', '2025-06-30', 'actif')`, [ownerId, propertyId]))).rejects.toThrow(/échu/);
    await expect(as(agent, (q) => q(`insert into mandates (owner_id, property_id, signed_date, status) values ($1, $2, current_date + 10, 'actif')`, [ownerId, propertyId]))).rejects.toThrow(/date de signature/);
  });

  it('un mandat qui expire masque l’annonce, puis la maintenance le passe « Expiré » et dépublie', async () => {
    const { propertyId } = await publishedProperty();
    expect(await isPublic(propertyId)).toBe(true);
    // Le temps passe : le mandat arrive à échéance (simulé en session serveur).
    await sql(`alter table mandates disable trigger mandates_validity`);
    await sql(`update mandates set end_date = current_date - 1 where property_id = $1 and status = 'actif'`, [propertyId]);
    await sql(`alter table mandates enable trigger mandates_validity`);
    expect(await isPublic(propertyId)).toBe(false);
    const [{ r }] = await as(agent, (q) => q(`select run_maintenance() r`));
    expect(r.mandates_expired).toBeGreaterThanOrEqual(1);
    const [p] = await sql(`select commercial_status, unpublished_at from properties where id = $1`, [propertyId]);
    expect(p.commercial_status).toBe('disponible');
    expect(p.unpublished_at).not.toBeNull();
    await expect(as(anon, (q) => q(`select run_maintenance()`))).rejects.toThrow(/permission denied/);
  });

  it('un bien publié devenu non conforme disparaît du site', async () => {
    const { propertyId } = await publishedProperty();
    await as(agent, (q) => q(`update properties set verification_status = 'non_conforme' where id = $1`, [propertyId]));
    expect(await isPublic(propertyId)).toBe(false);
    const photos = await as(anon, (q) => q('select id from public_property_photos where property_id = $1', [propertyId]));
    expect(photos).toHaveLength(0);
  });

  it('les dates de publication ne sont pas modifiables par le client', async () => {
    const { propertyId } = await publishedProperty();
    const [before] = await sql('select published_at from properties where id = $1', [propertyId]);
    await as(agent, (q) => q(`update properties set published_at = '2030-01-01' where id = $1`, [propertyId]));
    const [after] = await sql('select published_at from properties where id = $1', [propertyId]);
    expect(after.published_at).toEqual(before.published_at);
  });

  it('un bien vendu ne repasse pas en vente sans l’administrateur', async () => {
    const { propertyId } = await makePublishableProperty();
    await sql(`update properties set commercial_status = 'vendu' where id = $1`, [propertyId]);
    await expect(as(agent, (q) => q(`update properties set commercial_status = 'disponible' where id = $1`, [propertyId]))).rejects.toThrow(/administrateur/);
    await as(admin, (q) => q(`update properties set commercial_status = 'disponible' where id = $1`, [propertyId]));
  });

  it('changer de propriétaire est refusé tant qu’un mandat est actif', async () => {
    const { propertyId } = await makePublishableProperty();
    const [o] = await sql(`insert into owners (last_name, phone_primary) values ('NOUVEAU', '0701010199') returning id`);
    await expect(as(agent, (q) => q(`update properties set owner_id = $2 where id = $1`, [propertyId, o.id]))).rejects.toThrow(/Changement de propriétaire impossible/);
  });
});

describe('Ventes et commissions', () => {
  it('pas de dossier sur un bien vendu ; à la vente, les autres dossiers sont clos et la commission estimée devient exigible', async () => {
    const { propertyId, ownerId } = await publishedProperty(40000000);
    const [rule] = await sql(`select id from commission_rules where calc_type = 'pourcentage' limit 1`);
    const b1 = await newBuyer();
    const b2 = await newBuyer();
    const [t1] = await as(agent, (q) => q(`insert into transactions (property_id, buyer_id, owner_id, initial_asking_price, commission_rule_id) values ($1, $2, $3, 40000000, $4) returning id`, [propertyId, b1, ownerId, rule.id]));
    const [t2] = await as(agent, (q) => q(`insert into transactions (property_id, buyer_id, owner_id) values ($1, $2, $3) returning id`, [propertyId, b2, ownerId]));
    await as(agent, (q) => q(`update transactions set status = 'vente_conclue', agreed_price = 38000000, concluded_date = '2026-09-15' where id = $1`, [t1.id]));
    const [other] = await sql('select status, abandon_reason from transactions where id = $1', [t2.id]);
    expect(other.status).toBe('annulee');
    expect(other.abandon_reason).toMatch(/Bien vendu via TRX-/);
    const [fe] = await sql(`select amount_expected::bigint as a, status, entry_date::text as d, notes from financial_entries where transaction_id = $1`, [t1.id]);
    expect(fe).toMatchObject({ a: '1900000', status: 'exigible', d: '2026-09-15' }); // 5 % de 38 M, daté de la conclusion
    expect(fe.notes).toMatch(/à confirmer/);
    const b3 = await newBuyer();
    await expect(as(agent, (q) => q(`insert into transactions (property_id, buyer_id, owner_id) values ($1, $2, $3)`, [propertyId, b3, ownerId]))).rejects.toThrow(/vendu ou archivé/);
  });

  it('un dossier clôturé est figé pour l’agent (sauf notes) ; la commission suit la modification de l’administrateur', async () => {
    const { propertyId, ownerId } = await publishedProperty();
    const b = await newBuyer();
    const [t] = await as(agent, (q) => q(`insert into transactions (property_id, buyer_id, owner_id, commission_agreed) values ($1, $2, $3, 1000000) returning id`, [propertyId, b, ownerId]));
    await as(agent, (q) => q(`update transactions set status = 'vente_conclue', agreed_price = 30000000, concluded_date = current_date where id = $1`, [t.id]));
    await expect(as(agent, (q) => q(`update transactions set agreed_price = 1 where id = $1`, [t.id]))).rejects.toThrow(/Dossier clôturé/);
    await as(agent, (q) => q(`update transactions set notes = 'Acte signé chez le notaire' where id = $1`, [t.id]));
    await as(admin, (q) => q(`update transactions set commission_agreed = 1200000 where id = $1`, [t.id]));
    const [fe] = await sql(`select amount_expected::bigint as a, status from financial_entries where transaction_id = $1`, [t.id]);
    expect(fe).toEqual({ a: '1200000', status: 'exigible' });
  });

  it('rouvrir une vente défait ses effets, et est refusé si la commission a été encaissée', async () => {
    const { propertyId, ownerId } = await publishedProperty();
    const b = await newBuyer();
    const [t] = await as(agent, (q) => q(`insert into transactions (property_id, buyer_id, owner_id, commission_agreed) values ($1, $2, $3, 900000) returning id`, [propertyId, b, ownerId]));
    await as(agent, (q) => q(`update transactions set status = 'vente_conclue', agreed_price = 30000000, concluded_date = current_date where id = $1`, [t.id]));
    await as(admin, (q) => q(`update transactions set status = 'dossier_en_cours' where id = $1`, [t.id]));
    const [p] = await sql('select commercial_status from properties where id = $1', [propertyId]);
    expect(p.commercial_status).toBe('disponible');
    const [m] = await sql(`select count(*)::int n from mandates where property_id = $1 and status = 'actif'`, [propertyId]);
    expect(m.n).toBe(1);
    const [fe] = await sql(`select status from financial_entries where transaction_id = $1`, [t.id]);
    expect(fe.status).toBe('annule');

    // Deuxième vente avec encaissement : la réouverture est refusée.
    await as(agent, (q) => q(`update transactions set status = 'vente_conclue', concluded_date = current_date where id = $1`, [t.id]));
    const [fe2] = await sql(`select id from financial_entries where transaction_id = $1 and status = 'exigible'`, [t.id]);
    await as(comptable, (q) => q(`insert into payments (financial_entry_id, paid_on, amount, method) values ($1, current_date, 100000, 'especes')`, [fe2.id]));
    await expect(as(admin, (q) => q(`update transactions set status = 'dossier_en_cours' where id = $1`, [t.id]))).rejects.toThrow(/encaissements de commission/);
  });

  it('abandon d’un dossier sur un bien réservé : retour en ligne si conforme', async () => {
    const { propertyId, ownerId } = await publishedProperty();
    const b = await newBuyer();
    const [t] = await as(agent, (q) => q(`insert into transactions (property_id, buyer_id, owner_id) values ($1, $2, $3) returning id`, [propertyId, b, ownerId]));
    await as(agent, (q) => q(`update properties set commercial_status = 'reserve', unavailability_reason = 'Acompte versé' where id = $1`, [propertyId]));
    await as(agent, (q) => q(`update transactions set status = 'abandonnee', abandon_reason = 'Désistement' where id = $1`, [t.id]));
    const [p] = await sql('select commercial_status, unavailability_reason from properties where id = $1', [propertyId]);
    expect(p).toEqual({ commercial_status: 'publie', unavailability_reason: null });
  });
});

describe('Recettes', () => {
  it('une recette encaissée ne s’annule pas ; changer l’attendu recalcule le statut', async () => {
    const [e] = await as(comptable, (q) => q(`insert into financial_entries (entry_type, amount_expected, status) values ('honoraires', 100000, 'exigible') returning id`));
    await as(comptable, (q) => q(`insert into payments (financial_entry_id, paid_on, amount, method) values ($1, current_date, 100000, 'especes')`, [e.id]));
    await expect(as(comptable, (q) => q(`update financial_entries set status = 'annule' where id = $1`, [e.id]))).rejects.toThrow(/correction/);
    await as(comptable, (q) => q(`update financial_entries set amount_expected = 150000 where id = $1`, [e.id]));
    const [r] = await sql('select status, balance::bigint b from financial_entries where id = $1', [e.id]);
    expect(r).toEqual({ status: 'partiel', b: '50000' });
  });

  it('le rapport financier compte l’encaissé sur la même base partout', async () => {
    const [{ r }] = await as(comptable, (q) => q(`select finance_report(current_date - 400, current_date + 1) r`));
    const sumByType = (r.revenues_by_type as Array<{ received: number }>).reduce((s, x) => s + Number(x.received), 0);
    expect(sumByType).toBe(Number(r.revenues_received));
  });
});

describe('Auteurs, profils et journal', () => {
  it('created_by ne peut pas être usurpé : impossible de supprimer la tâche d’un collègue', async () => {
    const [t] = await as(agent, (q) => q(`insert into tasks (title, created_by) values ('Tâche agent 1', $1) returning id, created_by`, [agent2.uid]));
    expect(t.created_by).toBe(agent.uid);
    await as(agent2, (q) => q(`update tasks set created_by = $2 where id = $1`, [t.id, agent2.uid]));
    const deleted = await as(agent2, (q) => q('delete from tasks where id = $1 returning id', [t.id]));
    expect(deleted).toHaveLength(0);
  });

  it('un utilisateur ne change pas le courriel de son profil ; le changement Auth est synchronisé', async () => {
    await expect(as(assistant, (q) => q(`update profiles set email = 'admin@usurpe.test' where id = $1`, [assistant.uid]))).rejects.toThrow(/courriel/);
    await as(assistant, (q) => q(`update profiles set full_name = 'Nom modifiable' where id = $1`, [assistant.uid]));
    await sql(`update auth.users set email = 'nouveau.mail@test.invalid' where id = $1`, [assistant.uid]);
    const [p] = await sql('select email from profiles where id = $1', [assistant.uid]);
    expect(p.email).toBe('nouveau.mail@test.invalid');
  });

  it('les changements de rôle et de paramètres sont journalisés en base ; log_event refuse les actions libres', async () => {
    const u = await createUser(null);
    await as(admin, (q) => q(`update profiles set role = 'agent', is_active = true where id = $1`, [u.uid]));
    const logs = await sql(`select actor_id, changes from activity_logs where entity_type = 'profiles' and entity_id = $1 and action = 'update'`, [u.uid]);
    expect(logs.at(-1)!.actor_id).toBe(admin.uid);
    expect(logs.at(-1)!.changes.role).toEqual({ avant: null, apres: 'agent' });
    await as(admin, (q) => q(`update agency_settings set publication_requires_photo = false`));
    await as(admin, (q) => q(`update agency_settings set publication_requires_photo = true`));
    const s = await sql(`select changes from activity_logs where entity_type = 'agency_settings' order by id desc limit 2`);
    expect(s[0].changes.publication_requires_photo).toBeDefined();
    await expect(as(agent, (q) => q(`select log_event('suppression_compte', 'profiles', null, 'faux')`))).rejects.toThrow(/non autorisée/);
  });

  it('l’historique des statuts suit le périmètre de chaque rôle', async () => {
    const fin = await as(agent, (q) => q(`select * from status_history where entity_type = 'financial_entries'`));
    expect(fin).toHaveLength(0);
    const buy = await as(comptable, (q) => q(`select * from status_history where entity_type = 'buyers'`));
    expect(buy).toHaveLength(0);
    expect((await as(comptable, (q) => q(`select * from status_history where entity_type = 'financial_entries'`))).length).toBeGreaterThan(0);
  });
});

describe('Données personnelles', () => {
  it('l’administrateur anonymise un prospect issu d’une demande (droit à l’effacement)', async () => {
    const r = await submitFrom('10.0.2.1', { name: 'Personne Effacée' });
    const [i] = await sql('select id from inquiries where reference = $1', [r.reference]);
    const [{ b }] = await as(agent, (q) => q('select convert_inquiry_to_buyer($1) b', [i.id]));
    await expect(as(agent, (q) => q('select anonymize_buyer($1)', [b]))).rejects.toThrow(/administrateur/);
    await as(admin, (q) => q('select anonymize_buyer($1)', [b]));
    const [buyer] = await sql('select last_name, phone, email, status from buyers where id = $1', [b]);
    expect(buyer).toEqual({ last_name: 'ANONYMISÉ', phone: '000000', email: null, status: 'archive' });
    const [inq] = await sql('select full_name, message from inquiries where id = $1', [i.id]);
    expect(inq).toEqual({ full_name: 'Anonymisé', message: '[anonymisé]' });
    const inter = await sql('select summary from interactions where buyer_id = $1', [b]);
    expect(inter.every((x) => x.summary === '[anonymisé]')).toBe(true);
  });

  it('l’administrateur anonymise un propriétaire, qui est archivé', async () => {
    const [o] = await sql(`insert into owners (last_name, phone_primary, email) values ('A-EFFACER', '0701020304', 'a@b.ci') returning id`);
    await as(admin, (q) => q('select anonymize_owner($1)', [o.id]));
    const [r] = await sql('select last_name, email, archived_at from owners where id = $1', [o.id]);
    expect(r.last_name).toBe('ANONYMISÉ');
    expect(r.email).toBeNull();
    expect(r.archived_at).not.toBeNull();
  });
});

describe('Indicateurs', () => {
  it('correspondances : un terrain en hectares respecte une superficie minimale en m²', async () => {
    const [o] = await sql(`insert into owners (last_name, phone_primary) values ('HA', '0709876543') returning id`);
    await sql(`insert into properties (property_type, title, city, price_xof, area, area_unit, owner_id, commercial_status) values ('terrain', 'Grand terrain ha', 'Jacqueville', 30000000, 2, 'ha', $1, 'disponible')`, [o.id]);
    const [b] = await sql(`insert into buyers (last_name, phone, area_min, zones, property_types) values ('HAB', '0709876544', 5000, '{jacqueville}', '{terrain}') returning id`);
    const m = await as(agent, (q) => q('select title from property_matches($1)', [b.id]));
    expect(m.map((x) => x.title)).toContain('Grand terrain ha');
  });

  it('tableau de bord : « à vérifier » correspond au filtre de la liste, rappels comptés', async () => {
    const [{ d }] = await as(admin, (q) => q('select dashboard_stats() d'));
    const [{ n }] = await sql(`select count(*)::int n from properties where verification_status <> 'verifie' and commercial_status <> 'archive'`);
    expect(d.properties.a_verifier).toBe(n);
    expect(d.mandate_reminders).toBeTypeOf('number');
    expect(d.visit_follow_ups).toBeTypeOf('number');
    expect(d.finance.commissions_agreed_open).toBeDefined();
    const [{ open }] = await sql(`select count(*)::int open from transactions where status in ${OPEN}`);
    expect(d.transactions_open).toBe(open);
  });
});
