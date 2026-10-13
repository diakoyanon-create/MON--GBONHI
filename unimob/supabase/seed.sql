-- =====================================================================
-- Données de démonstration — ENTIÈREMENT FICTIVES.
-- Noms, numéros et biens sont inventés (numéros au format 00 00 …).
-- Tous les biens sont marqués is_demo = true et affichés comme fictifs.
-- Ne jamais charger ce fichier en production.
-- =====================================================================

update public.agency_settings set
  agency_name = 'Mon Agence Immobilière (démo)',
  tagline = 'Vente de terrains, maisons et appartements en Côte d''Ivoire',
  phone = '+225 00 00 00 00 00',
  whatsapp_number = '2250000000000',
  email = 'contact@exemple.invalid',
  address = 'Adresse fictive, Abidjan',
  about = 'Agence de démonstration. Les informations affichées sont fictives et servent uniquement aux tests.',
  zones_served = array['Cocody', 'Bingerville', 'Grand-Bassam', 'Yopougon', 'Marcory'],
  document_footer = 'Document de démonstration — données fictives'
where id = 1;

insert into public.commission_rules (name, calc_type, rate_percent, fixed_amount, min_amount, payer, notes) values
  ('Pourcentage standard (exemple)', 'pourcentage', 5, null, 250000, 'vendeur',
   'Taux d''exemple à remplacer par les accords réels de l''agence. Aucune valeur légale.'),
  ('Forfait terrain (exemple)', 'fixe', null, 500000, null, 'vendeur', 'Forfait d''exemple.');

do $$
declare
  o1 uuid; o2 uuid; o3 uuid;
  p uuid;
  b1 uuid; b2 uuid; b3 uuid;
  r uuid;
  t uuid;
  props jsonb := '[
    {"type":"maison","title":"Villa 4 pièces avec jardin (fictif)","city":"Abidjan","district":"Cocody","price":85000000,"area":400,"bed":3,"bath":2,"feat":["Jardin","Garage","Forage"],"owner":1,"publish":true,"featured":true},
    {"type":"terrain","title":"Terrain 500 m² viabilisé (fictif)","city":"Bingerville","district":"Centre","price":25000000,"area":500,"bed":null,"bath":null,"feat":["Viabilisé","Accès bitumé"],"owner":1,"publish":true,"featured":false},
    {"type":"appartement","title":"Appartement 3 pièces lumineux (fictif)","city":"Abidjan","district":"Marcory","price":48000000,"area":110,"bed":2,"bath":1,"feat":["Balcon","Parking"],"owner":2,"publish":true,"featured":true},
    {"type":"local_commercial","title":"Local commercial sur axe passant (fictif)","city":"Abidjan","district":"Yopougon","price":60000000,"area":150,"bed":null,"bath":1,"feat":["Vitrine"],"owner":2,"publish":true,"featured":false},
    {"type":"terrain","title":"Terrain 1000 m² proche plage (fictif)","city":"Grand-Bassam","district":"Mockeyville","price":40000000,"area":1000,"bed":null,"bath":null,"feat":["Proche plage"],"owner":3,"publish":false,"featured":false},
    {"type":"maison","title":"Maison basse 3 pièces (fictif)","city":"Abidjan","district":"Yopougon","price":30000000,"area":250,"bed":2,"bath":1,"feat":["Cour"],"owner":3,"publish":false,"featured":false}
  ]';
  x jsonb;
  owners uuid[];
  i int := 0;
begin
  insert into public.owners (last_name, first_names, phone_primary, locality, contact_preference, source, first_contact_date, notes)
  values ('KOUAME-DEMO', 'Aya', '+225 00 00 00 00 01', 'Cocody', 'whatsapp', 'Recommandation', current_date - 60, 'Propriétaire fictif')
  returning id into o1;
  insert into public.owners (last_name, first_names, phone_primary, locality, contact_preference, source, first_contact_date)
  values ('KONE-DEMO', 'Ibrahim', '+225 00 00 00 00 02', 'Marcory', 'telephone', 'Panneau', current_date - 45)
  returning id into o2;
  insert into public.owners (last_name, first_names, phone_primary, email, locality, contact_preference, source, first_contact_date)
  values ('YAO-DEMO', 'Marie', '+225 00 00 00 00 03', 'marie.demo@exemple.invalid', 'Grand-Bassam', 'email', 'Site web', current_date - 20)
  returning id into o3;
  owners := array[o1, o2, o3];

  for x in select * from jsonb_array_elements(props) loop
    i := i + 1;
    insert into public.properties (property_type, title, description, region, city, district,
      location_description, price_xof, area, bedrooms, bathrooms, features, owner_id, listing_origin,
      verification_status, commercial_status, is_featured, is_demo)
    values ((x ->> 'type')::public.property_type, x ->> 'title',
      'Bien de démonstration entièrement fictif, utilisé pour présenter le fonctionnement de la plateforme. ' ||
      'Il ne correspond à aucun bien réel disponible à la vente.',
      'Lagunes', x ->> 'city', x ->> 'district', 'Quartier ' || (x ->> 'district') || ' (localisation indicative)',
      (x ->> 'price')::numeric, (x ->> 'area')::numeric, (x ->> 'bed')::smallint, (x ->> 'bath')::smallint,
      array(select jsonb_array_elements_text(x -> 'feat')), owners[(x ->> 'owner')::int], 'Démonstration',
      case when (x ->> 'publish')::boolean then 'verifie' else 'a_verifier' end::public.verification_status,
      case when (x ->> 'publish')::boolean then 'disponible' else 'a_verifier' end::public.property_status,
      (x ->> 'featured')::boolean, true)
    returning id into p;

    insert into public.property_photos (property_id, storage_path, caption, position, is_primary)
    values (p, 'demo/bien-' || i || '.svg', 'Illustration fictive', 0, true);

    if (x ->> 'publish')::boolean then
      insert into public.mandates (owner_id, property_id, mandate_type, signed_date, start_date, end_date,
        commission_calc, commission_rate_percent, status, conditions)
      values (owners[(x ->> 'owner')::int], p, 'simple', current_date - 30, current_date - 30, current_date + 150,
        'pourcentage', 5, 'actif', 'Mandat fictif de démonstration');
      update public.properties set commercial_status = 'publie' where id = p;
    end if;
  end loop;

  insert into public.buyers (last_name, first_names, phone, budget_min, budget_max, zones, property_types,
    source, status, consent_contact, consent_date, next_follow_up_at, notes)
  values ('DIALLO-DEMO', 'Fatou', '+225 00 00 00 00 11', 20000000, 50000000, array['Bingerville', 'Marcory'],
    array['terrain', 'appartement']::public.property_type[], 'Site web', 'besoin_qualifie', true, now(), now() + interval '2 days',
    'Prospect fictif')
  returning id into b1;
  insert into public.buyers (last_name, first_names, phone, budget_max, zones, property_types, source, status, consent_contact, consent_date)
  values ('TRAORE-DEMO', 'Moussa', '+225 00 00 00 00 12', 90000000, array['Cocody'],
    array['maison']::public.property_type[], 'WhatsApp', 'visite_programmee', true, now())
  returning id into b2;
  insert into public.buyers (last_name, phone, source, status)
  values ('BAMBA-DEMO', '+225 00 00 00 00 13', 'Téléphone', 'nouveau')
  returning id into b3;

  select id into p from public.properties where title like 'Villa 4 pièces%';
  insert into public.visits (property_id, buyer_id, scheduled_at, location, status)
  values (p, b2, date_trunc('day', now()) + interval '2 days 10 hours', 'Sur place', 'confirmee');

  select id into r from public.commission_rules where name = 'Pourcentage standard (exemple)';
  insert into public.transactions (property_id, buyer_id, owner_id, mandate_id, initial_asking_price, status, commission_rule_id, notes)
  select p, b2, o1, m.id, 85000000, 'negociation', r, 'Dossier fictif'
    from public.mandates m where m.property_id = p and m.status = 'actif'
  returning id into t;
  insert into public.negotiations (transaction_id, offer_kind, from_party, amount, status)
  values (t, 'offre', 'acheteur', 78000000, 'en_attente');

  insert into public.inquiries (full_name, phone, message, property_id, property_reference_input, consent, source)
  select 'Visiteur DÉMO', '+225 00 00 00 00 21', 'Bonjour, ce terrain est-il toujours disponible ? (message fictif)',
         id, reference, true, 'site_web'
    from public.properties where title like 'Terrain 500%';

  insert into public.tasks (title, category, priority, due_at, buyer_id, status)
  values ('Rappeler le prospect DIALLO-DEMO', 'Relance', 'haute', now() + interval '1 day', b1, 'a_faire'),
         ('Vérifier les documents du terrain de Grand-Bassam', 'Juridique', 'normale', now() - interval '1 day', null, 'a_faire');

  insert into public.expenses (expense_date, category, description, amount, payment_method)
  values (current_date - 5, 'Publicité', 'Annonces réseaux sociaux (fictif)', 35000, 'mobile_money'),
         (current_date - 2, 'Transport', 'Déplacements visites (fictif)', 15000, 'especes');
end $$;
