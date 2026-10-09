import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, as, closeDb, createUser, makePublishableProperty, sql, type Who } from './helpers';

let admin: Who, agent: Who, comptable: Who, visitor: Who;
beforeAll(async () => {
  admin = await createUser('admin');
  agent = await createUser('agent');
  comptable = await createUser('comptable');
  visitor = await createUser(null);
});
afterAll(closeDb);

const submit = (who: Who, args: Record<string, unknown>) =>
  as(who, (q) =>
    q(`select submit_inquiry(p_full_name => $1, p_phone => $2, p_message => $3, p_email => $4,
          p_property_reference => $5, p_contact_preference => $6, p_consent => $7, p_website => $8) r`, [
      args.name ?? 'Visiteur Test', args.phone ?? '+225 05 00 00 00 99', args.message ?? 'Je souhaite visiter ce bien.',
      args.email ?? null, args.ref ?? null, args.pref ?? 'whatsapp', args.consent ?? true, args.website ?? null,
    ]),
  ).then((r) => r[0].r);

describe('Demandes publiques', () => {
  it('la demande est enregistrée, liée au bien publié, statut Nouveau, visible par l’admin', async () => {
    const { propertyId, reference } = await makePublishableProperty();
    await sql(`update properties set commercial_status = 'publie' where id = $1`, [propertyId]);
    const res = await submit(anon, { ref: reference.toLowerCase(), phone: '+225 05 00 00 00 01' });
    expect(res.ok).toBe(true);
    expect(res.reference).toMatch(/^DEM-/);
    const rows = await as(admin, (q) => q('select * from inquiries where reference = $1', [res.reference]));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('nouveau');
    expect(rows[0].property_id).toBe(propertyId);
    expect(rows[0].consent).toBe(true);
    expect(rows[0].client_fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('une référence de bien non publié n’est pas rattachée', async () => {
    const [p] = await sql(`select reference from properties where commercial_status = 'a_verifier' limit 1`);
    const res = await submit(anon, { ref: p.reference, phone: '+225 05 00 00 00 02' });
    const [row] = await sql('select property_id, property_reference_input from inquiries where reference = $1', [res.reference]);
    expect(row.property_id).toBeNull();
    expect(row.property_reference_input).toBe(p.reference);
  });

  it('un visiteur (anonyme ou connecté sans rôle) ne peut pas lire les demandes', async () => {
    await expect(as(anon, (q) => q('select * from inquiries'))).rejects.toThrow(/permission denied/);
    expect(await as(visitor, (q) => q('select * from inquiries'))).toHaveLength(0);
  });

  it('valide les données et refuse les injections de format', async () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ name: 'X' }, /Nom invalide/],
      [{ phone: 'abc' }, /téléphone invalide/],
      [{ phone: "0102'; drop table inquiries; --" }, /téléphone invalide/],
      [{ email: 'pas-un-mail' }, /électronique invalide/],
      [{ message: 'hey' }, /entre 5 et 2000/],
      [{ message: 'x'.repeat(2001) }, /entre 5 et 2000/],
      [{ ref: "BIEN' OR 1=1" }, /Référence de bien invalide/],
      [{ consent: false }, /consentement/],
      [{ pref: 'pigeon' }, /Préférence de contact invalide/],
    ];
    for (const [args, err] of cases) {
      await expect(submit(anon, { phone: '+225 05 00 00 00 03', ...args })).rejects.toThrow(err);
    }
    const [{ count }] = await sql(`select count(*)::int from inquiries`);
    expect(count).toBeGreaterThan(0);
  });

  it('le champ piège anti-robot ne crée aucune demande', async () => {
    const before = (await sql(`select count(*)::int c from inquiries`))[0].c;
    const res = await submit(anon, { website: 'http://spam.example', phone: '+225 05 00 00 00 04' });
    expect(res).toEqual({ ok: true });
    const after = (await sql(`select count(*)::int c from inquiries`))[0].c;
    expect(after).toBe(before);
  });

  it('limite les soumissions répétées (même numéro)', async () => {
    const phone = '+225 05 00 00 00 05';
    for (let i = 0; i < 3; i++) await submit(anon, { phone });
    await expect(submit(anon, { phone })).rejects.toThrow(/Trop de demandes/);
  });

  it('convertit une demande en prospect avec historique', async () => {
    const res = await submit(anon, { name: 'Awa Prospect Test', phone: '+225 05 00 00 00 06' });
    const [i] = await sql('select id from inquiries where reference = $1', [res.reference]);
    const [{ b }] = await as(agent, (q) => q('select convert_inquiry_to_buyer($1) b', [i.id]));
    const [buyer] = await sql('select last_name, first_names, status, consent_contact from buyers where id = $1', [b]);
    expect(buyer).toMatchObject({ last_name: 'Awa', first_names: 'Prospect Test', status: 'a_contacter', consent_contact: true });
    const [inq] = await sql('select status, buyer_id from inquiries where id = $1', [i.id]);
    expect(inq).toEqual({ status: 'converti', buyer_id: b });
    const inter = await sql('select * from interactions where inquiry_id = $1', [i.id]);
    expect(inter).toHaveLength(1);
    await expect(as(comptable, (q) => q('select convert_inquiry_to_buyer($1)', [i.id]))).rejects.toThrow(/Accès refusé/);
  });
});

describe('Visites, négociation et vente', () => {
  async function setup() {
    const p = await makePublishableProperty({ price: 60000000 });
    await sql(`update properties set commercial_status = 'publie' where id = $1`, [p.propertyId]);
    const [b] = await sql(`insert into buyers (last_name, phone) values ('ACHETEUR', '0711111111') returning id`);
    const [rule] = await sql(`select id from commission_rules where calc_type = 'pourcentage' limit 1`);
    return { ...p, buyerId: b.id as string, ruleId: rule.id as string };
  }

  it('une visite est reliée au bien et au prospect, avec rappels', async () => {
    const { propertyId, buyerId } = await setup();
    const [v] = await as(agent, (q) =>
      q(`insert into visits (property_id, buyer_id, scheduled_at, status) values ($1, $2, now() + interval '1 day', 'a_confirmer') returning reference`, [propertyId, buyerId]));
    expect(v.reference).toMatch(/^VIS-/);
    await as(agent, (q) => q(`update visits set status = 'effectuee', report = 'Très intéressé', interest_level = 4 where reference = $1`, [v.reference]));
    await expect(
      as(agent, (q) => q(`update visits set interest_level = 9 where reference = $1`, [v.reference])),
    ).rejects.toThrow(/check constraint/);
    const hist = await sql(`select new_status from status_history where entity_type = 'visits' and entity_id = (select id from visits where reference = $1) order by id`, [v.reference]);
    expect(hist.map((h) => h.new_status)).toEqual(['a_confirmer', 'effectuee']);
  });

  it('une vente conclue retire le bien du catalogue sans effacer l’historique', async () => {
    const { propertyId, ownerId, buyerId, ruleId } = await setup();
    const [t] = await as(agent, (q) =>
      q(`insert into transactions (property_id, buyer_id, owner_id, initial_asking_price, commission_rule_id) values ($1, $2, $3, 60000000, $4) returning id, reference`,
        [propertyId, buyerId, ownerId, ruleId]));
    // Ouverture d'un dossier => bien « sous négociation », toujours visible.
    let [p] = await sql('select commercial_status from properties where id = $1', [propertyId]);
    expect(p.commercial_status).toBe('sous_negociation');
    expect(await as(anon, (q) => q('select id from public_properties where id = $1', [propertyId]))).toHaveLength(1);

    await as(agent, (q) => q(`insert into negotiations (transaction_id, offer_kind, from_party, amount) values ($1, 'offre', 'acheteur', 55000000)`, [t.id]));
    await as(agent, (q) => q(`insert into negotiations (transaction_id, offer_kind, from_party, amount) values ($1, 'contre_offre', 'vendeur', 58000000)`, [t.id]));

    // Offre acceptée ≠ vente conclue.
    await as(agent, (q) => q(`update transactions set status = 'offre_acceptee_sous_conditions', agreed_price = 58000000 where id = $1`, [t.id]));
    [p] = await sql('select commercial_status from properties where id = $1', [propertyId]);
    expect(p.commercial_status).toBe('sous_negociation');

    // Conclusion : date obligatoire.
    await expect(as(agent, (q) => q(`update transactions set status = 'vente_conclue' where id = $1`, [t.id]))).rejects.toThrow(/check constraint/);
    await as(agent, (q) => q(`update transactions set status = 'vente_conclue', concluded_date = current_date, commission_agreed = 2900000 where id = $1`, [t.id]));

    [p] = await sql('select commercial_status, unpublished_at from properties where id = $1', [propertyId]);
    expect(p.commercial_status).toBe('vendu');
    expect(p.unpublished_at).not.toBeNull();
    expect(await as(anon, (q) => q('select id from public_properties where id = $1', [propertyId]))).toHaveLength(0);

    // Historique conservé.
    const hist = await sql(`select new_status from status_history where entity_type = 'transactions' and entity_id = $1 order by id`, [t.id]);
    expect(hist.map((h) => h.new_status)).toEqual(['negociation', 'offre_acceptee_sous_conditions', 'vente_conclue']);
    expect(await sql('select * from negotiations where transaction_id = $1', [t.id])).toHaveLength(2);
    const [m] = await sql(`select status from mandates where property_id = $1`, [propertyId]);
    expect(m.status).toBe('cloture');
    const [buyer] = await sql('select status from buyers where id = $1', [buyerId]);
    expect(buyer.status).toBe('converti');

    // Commission exigible créée automatiquement.
    const [fe] = await sql(`select amount_expected, status from financial_entries where transaction_id = $1`, [t.id]);
    expect(fe).toEqual({ amount_expected: '2900000', status: 'exigible' });

    // Un agent ne peut pas rouvrir un dossier clôturé.
    await expect(as(agent, (q) => q(`update transactions set status = 'dossier_en_cours' where id = $1`, [t.id]))).rejects.toThrow(/administrateur/);
  });

  it('abandon : motif obligatoire et le bien redevient publié', async () => {
    const { propertyId, ownerId, buyerId } = await setup();
    const [t] = await as(agent, (q) =>
      q(`insert into transactions (property_id, buyer_id, owner_id) values ($1, $2, $3) returning id`, [propertyId, buyerId, ownerId]));
    await expect(as(agent, (q) => q(`update transactions set status = 'abandonnee' where id = $1`, [t.id]))).rejects.toThrow(/check constraint/);
    await as(agent, (q) => q(`update transactions set status = 'abandonnee', abandon_reason = 'Financement refusé' where id = $1`, [t.id]));
    const [p] = await sql('select commercial_status from properties where id = $1', [propertyId]);
    expect(p.commercial_status).toBe('publie');
  });

  it('refuse une transaction dont le vendeur n’est pas le propriétaire du bien', async () => {
    const { propertyId, buyerId } = await setup();
    const [other] = await sql(`insert into owners (last_name, phone_primary) values ('FAUX', '0708080808') returning id`);
    await expect(
      as(agent, (q) => q(`insert into transactions (property_id, buyer_id, owner_id) values ($1, $2, $3)`, [propertyId, buyerId, other.id])),
    ).rejects.toThrow(/vendeur/);
  });
});
