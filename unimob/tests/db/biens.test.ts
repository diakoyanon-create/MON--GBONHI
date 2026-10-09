import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anon, as, closeDb, createUser, makePublishableProperty, sql, type Who } from './helpers';

let agent: Who;
beforeAll(async () => {
  agent = await createUser('agent');
});
afterAll(closeDb);

describe('Création d’un bien', () => {
  it('attribue une référence unique automatiquement', async () => {
    const [owner] = await sql(`insert into owners (last_name, phone_primary) values ('REF', '0701010101') returning id`);
    const rows = await as(agent, (q) =>
      q(`insert into properties (property_type, title, city, owner_id) values
           ('terrain', 'Terrain A', 'Abidjan', $1), ('terrain', 'Terrain B', 'Abidjan', $1)
         returning reference, commercial_status, created_by`, [owner.id]),
    );
    expect(rows[0].reference).toMatch(/^BIEN-\d{4}-\d{5}$/);
    expect(rows[0].reference).not.toBe(rows[1].reference);
    expect(rows[0].commercial_status).toBe('brouillon');
    expect(rows[0].created_by).toBe(agent.uid);
  });

  it('refuse une référence en double (insensible à la casse/espaces)', async () => {
    await as(agent, (q) => q(`insert into properties (reference, property_type, title, city) values ('TEST-DOUBLON', 'maison', 'Maison 1', 'Abidjan')`));
    await expect(
      as(agent, (q) => q(`insert into properties (reference, property_type, title, city) values ('  test-doublon ', 'maison', 'Maison 2', 'Abidjan')`)),
    ).rejects.toThrow(/duplicate key|unique/);
  });

  it('valide les champs (prix négatif, titre trop court, coordonnées)', async () => {
    for (const values of [
      `('maison', 'Ok titre', 'Abidjan', -5, null)`,
      `('maison', 'X', 'Abidjan', 10, null)`,
      `('maison', 'Ok titre', 'Abidjan', 10, 200)`,
    ]) {
      await expect(
        as(agent, (q) => q(`insert into properties (property_type, title, city, price_xof, latitude) values ${values}`)),
      ).rejects.toThrow(/check constraint/);
    }
  });

  it('stocke les montants en numérique exact (pas de flottant)', async () => {
    const [col] = await sql(`select data_type from information_schema.columns where table_name = 'properties' and column_name = 'price_xof'`);
    expect(col.data_type).toBe('numeric');
  });

  it('apparaît dans le tableau de bord', async () => {
    const before = (await as(agent, (q) => q('select dashboard_stats() d')))[0].d.properties.brouillons;
    await as(agent, (q) => q(`insert into properties (property_type, title, city) values ('maison', 'Pour le tableau', 'Abidjan')`));
    const after = (await as(agent, (q) => q('select dashboard_stats() d')))[0].d.properties.brouillons;
    expect(after).toBe(before + 1);
  });
});

describe('Publication', () => {
  it('un brouillon reste privé', async () => {
    const [p] = await as(agent, (q) => q(`insert into properties (property_type, title, city) values ('maison', 'Brouillon privé', 'Abidjan') returning id`));
    const pub = await as(anon, (q) => q('select id from public_properties where id = $1', [p.id]));
    expect(pub).toHaveLength(0);
  });

  it('on ne peut pas créer un bien directement publié', async () => {
    await expect(
      as(agent, (q) => q(`insert into properties (property_type, title, city, commercial_status) values ('maison', 'Direct', 'Abidjan', 'publie')`)),
    ).rejects.toThrow(/créé puis publié/);
  });

  it('refuse la publication tant que les conditions ne sont pas remplies et les liste', async () => {
    const [p] = await as(agent, (q) => q(`insert into properties (property_type, title, city) values ('maison', 'Incomplet', 'Abidjan') returning id`));
    const [{ b }] = await as(agent, (q) => q('select publication_blockers($1) b', [p.id]));
    expect(b).toEqual(expect.arrayContaining([
      'Le prix doit être renseigné', 'Le bien doit être vérifié', 'Un mandat actif est requis', 'Au moins une photo est requise',
    ]));
    await expect(as(agent, (q) => q(`update properties set commercial_status = 'publie' where id = $1`, [p.id]))).rejects.toThrow(/Publication impossible/);
  });

  it('un bien autorisé est publié puis dépublié du catalogue', async () => {
    const { propertyId } = await makePublishableProperty();
    await as(agent, (q) => q(`update properties set commercial_status = 'publie' where id = $1`, [propertyId]));
    let pub = await as(anon, (q) => q('select id, primary_photo_path from public_properties where id = $1', [propertyId]));
    expect(pub).toHaveLength(1);
    expect(pub[0].primary_photo_path).toContain(propertyId);
    const photos = await as(anon, (q) => q('select * from public_property_photos where property_id = $1', [propertyId]));
    expect(photos).toHaveLength(1);

    await as(agent, (q) => q(`update properties set commercial_status = 'disponible' where id = $1`, [propertyId]));
    pub = await as(anon, (q) => q('select id from public_properties where id = $1', [propertyId]));
    expect(pub).toHaveLength(0);
    const photosAfter = await as(anon, (q) => q('select * from public_property_photos where property_id = $1', [propertyId]));
    expect(photosAfter).toHaveLength(0);

    const [row] = await sql('select published_at, unpublished_at from properties where id = $1', [propertyId]);
    expect(row.published_at).not.toBeNull();
    expect(row.unpublished_at).not.toBeNull();
    const hist = await sql(`select old_status, new_status from status_history where entity_id = $1 order by id`, [propertyId]);
    expect(hist.map((h) => h.new_status)).toEqual(['disponible', 'publie', 'disponible']);
  });

  it('les paramètres de l’agence peuvent assouplir les conditions', async () => {
    await sql(`update agency_settings set publication_requires_active_mandate = false, publication_requires_photo = false`);
    try {
      const [p] = await as(agent, (q) => q(`insert into properties (property_type, title, city, price_xof, description, verification_status)
        values ('terrain', 'Sans mandat', 'Abidjan', 1000000, 'Une description assez longue pour publier.', 'verifie') returning id`));
      await as(agent, (q) => q(`update properties set commercial_status = 'publie' where id = $1`, [p.id]));
    } finally {
      await sql(`update agency_settings set publication_requires_active_mandate = true, publication_requires_photo = true`);
    }
  });

  it('retirer un bien exige un motif', async () => {
    const [p] = await as(agent, (q) => q(`insert into properties (property_type, title, city) values ('maison', 'A retirer', 'Abidjan') returning id`));
    await expect(as(agent, (q) => q(`update properties set commercial_status = 'retire' where id = $1`, [p.id]))).rejects.toThrow(/motif/);
    await as(agent, (q) => q(`update properties set commercial_status = 'retire', unavailability_reason = 'Le vendeur se rétracte' where id = $1`, [p.id]));
  });

  it('un bien vendu ne peut pas être republié', async () => {
    const { propertyId } = await makePublishableProperty();
    await sql(`update properties set commercial_status = 'vendu' where id = $1`, [propertyId]);
    await expect(as(agent, (q) => q(`update properties set commercial_status = 'publie' where id = $1`, [propertyId]))).rejects.toThrow(/vendu ou archivé/);
  });
});

describe('Photos', () => {
  it('une seule photo principale ; la première devient principale', async () => {
    const [p] = await as(agent, (q) => q(`insert into properties (property_type, title, city) values ('maison', 'Galerie', 'Abidjan') returning id`));
    await as(agent, (q) => q(`insert into property_photos (property_id, storage_path, position) values ($1, $2, 0), ($1, $3, 1)`, [p.id, `${p.id}/1.jpg`, `${p.id}/2.jpg`]));
    let rows = await sql('select storage_path, is_primary from property_photos where property_id = $1 order by position', [p.id]);
    expect(rows.map((r) => r.is_primary)).toEqual([true, false]);
    await as(agent, (q) => q(`update property_photos set is_primary = true where storage_path = $1`, [`${p.id}/2.jpg`]));
    rows = await sql('select storage_path, is_primary from property_photos where property_id = $1 order by position', [p.id]);
    expect(rows.map((r) => r.is_primary)).toEqual([false, true]);
  });
});

describe('Mandats', () => {
  it('refuse un mandat dont le propriétaire ne correspond pas au bien', async () => {
    const { propertyId } = await makePublishableProperty();
    const [other] = await sql(`insert into owners (last_name, phone_primary) values ('AUTRE', '0709090909') returning id`);
    await expect(
      as(agent, (q) => q(`insert into mandates (owner_id, property_id) values ($1, $2)`, [other.id, propertyId])),
    ).rejects.toThrow(/propriétaire du mandat/);
  });

  it('un seul mandat actif par bien et signature obligatoire pour être actif', async () => {
    const { propertyId, ownerId } = await makePublishableProperty();
    await expect(
      as(agent, (q) => q(`insert into mandates (owner_id, property_id, signed_date, status) values ($1, $2, current_date, 'actif')`, [ownerId, propertyId])),
    ).rejects.toThrow(/duplicate key|unique/);
    await expect(
      as(agent, (q) => q(`insert into mandates (owner_id, property_id, status) values ($1, $2, 'expire')`, [ownerId, propertyId])),
    ).rejects.toThrow(/check constraint/);
  });

  it('la suppression d’un propriétaire lié à des biens est bloquée (pas de cascade)', async () => {
    const { ownerId } = await makePublishableProperty();
    await expect(sql('delete from owners where id = $1', [ownerId])).rejects.toThrow(/foreign key/);
  });
});

describe('Contacts', () => {
  it('détecte prudemment les doublons par téléphone normalisé ou courriel', async () => {
    await as(agent, (q) => q(`insert into buyers (last_name, phone, email) values ('DOUBLON', '+225 07 11 22 33 44', 'dup@test.invalid')`));
    const byPhone = await as(agent, (q) => q(`select * from find_duplicate_contacts('0711223344', null)`));
    expect(byPhone.some((r) => r.full_name === 'DOUBLON')).toBe(true);
    const byMail = await as(agent, (q) => q(`select * from find_duplicate_contacts(null, 'DUP@test.invalid')`));
    expect(byMail.some((r) => r.full_name === 'DOUBLON')).toBe(true);
  });

  it('refuse un budget minimal supérieur au maximal', async () => {
    await expect(
      as(agent, (q) => q(`insert into buyers (last_name, phone, budget_min, budget_max) values ('B', '0700000001', 10, 5)`)),
    ).rejects.toThrow(/check constraint/);
  });

  it('propose les biens correspondant aux critères du prospect', async () => {
    const [b] = await sql(`select id from buyers where last_name = 'DIALLO-DEMO'`);
    const matches = await as(agent, (q) => q('select reference, property_type, price_xof, city, district from property_matches($1)', [b.id]));
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(['terrain', 'appartement']).toContain(m.property_type);
      expect(Number(m.price_xof)).toBeLessThanOrEqual(50000000);
    }
  });
});
