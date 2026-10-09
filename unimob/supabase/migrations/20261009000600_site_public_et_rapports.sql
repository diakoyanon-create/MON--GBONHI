-- =====================================================================
-- 0006 — Site public (vues restreintes, demandes contrôlées),
--        commissions, tableau de bord et rapports.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Vues publiques : uniquement les champs autorisés des biens publiés.
-- (Vues propriétaires = contournent RLS de façon contrôlée ; aucune
--  donnée propriétaire, document, note interne ou coordonnée GPS.)
-- ---------------------------------------------------------------------
create view public.public_properties as
  select p.id, p.reference, p.property_type, p.title, p.description, p.region, p.city,
         p.district, p.location_description, p.price_xof, p.negotiable, p.area, p.area_unit,
         p.bedrooms, p.bathrooms, p.features, p.commercial_status, p.is_featured, p.is_demo,
         p.published_at,
         (select ph.storage_path from public.property_photos ph
           where ph.property_id = p.id order by ph.is_primary desc, ph.position, ph.created_at limit 1) as primary_photo_path
    from public.properties p
   where public.is_public_status(p.commercial_status);

create view public.public_property_photos as
  select ph.id, ph.property_id, ph.storage_path, ph.caption, ph.position, ph.is_primary
    from public.property_photos ph
    join public.properties p on p.id = ph.property_id
   where public.is_public_status(p.commercial_status);

revoke all on public.public_properties, public.public_property_photos from anon, authenticated;
grant select on public.public_properties, public.public_property_photos to anon, authenticated;

-- ---------------------------------------------------------------------
-- Formulaire public : point d'entrée unique, validé et limité.
-- ---------------------------------------------------------------------
create or replace function public.submit_inquiry(
  p_full_name text,
  p_phone text,
  p_message text,
  p_email text default null,
  p_property_reference text default null,
  p_contact_preference text default 'telephone',
  p_consent boolean default false,
  p_website text default null -- champ piège anti-robots, doit rester vide
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_full_name, ''), '[[:cntrl:]]', '', 'g'));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_msg text := btrim(regexp_replace(coalesce(p_message, ''), '[^[:print:][:space:]]', '', 'g'));
  v_ref text := nullif(upper(btrim(coalesce(p_property_reference, ''))), '');
  v_pref public.contact_preference;
  v_property uuid;
  v_fp text;
  v_headers jsonb;
  v_reference text;
begin
  -- Robot détecté : réponse neutre, rien n'est enregistré.
  if coalesce(btrim(p_website), '') <> '' then
    return jsonb_build_object('ok', true);
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Nom invalide' using errcode = '22023';
  end if;
  if v_phone !~ '^\+?[0-9][0-9 .\-]{6,19}$' then
    raise exception 'Numéro de téléphone invalide' using errcode = '22023';
  end if;
  if v_email is not null and (char_length(v_email) > 160 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Adresse électronique invalide' using errcode = '22023';
  end if;
  if char_length(v_msg) < 5 or char_length(v_msg) > 2000 then
    raise exception 'Le message doit contenir entre 5 et 2000 caractères' using errcode = '22023';
  end if;
  if v_ref is not null and (char_length(v_ref) > 40 or v_ref !~ '^[A-Z0-9\-]+$') then
    raise exception 'Référence de bien invalide' using errcode = '22023';
  end if;
  if not coalesce(p_consent, false) then
    raise exception 'Le consentement est requis pour traiter votre demande' using errcode = '22023';
  end if;
  begin
    v_pref := coalesce(nullif(p_contact_preference, ''), 'telephone')::public.contact_preference;
  exception when invalid_text_representation then
    raise exception 'Préférence de contact invalide' using errcode = '22023';
  end;

  -- Empreinte client (IP transmise par la passerelle), stockée hachée uniquement.
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_fp := encode(extensions.digest(coalesce(
            v_headers ->> 'cf-connecting-ip',
            split_part(v_headers ->> 'x-forwarded-for', ',', 1),
            'inconnu'), 'sha256'), 'hex');

  -- Limitation de débit.
  if (select count(*) from public.inquiries
       where public.normalize_phone(phone) = public.normalize_phone(v_phone)
         and created_at > now() - interval '15 minutes') >= 3 then
    raise exception 'Trop de demandes envoyées. Merci de réessayer plus tard.' using errcode = '54000';
  end if;
  if v_fp is not null and (select count(*) from public.inquiries
       where client_fingerprint = v_fp and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Trop de demandes envoyées. Merci de réessayer plus tard.' using errcode = '54000';
  end if;

  if v_ref is not null then
    select id into v_property from public.properties
     where reference = v_ref and public.is_public_status(commercial_status);
  end if;

  insert into public.inquiries (full_name, phone, email, property_id, property_reference_input,
                                message, contact_preference, consent, consent_text, source, client_fingerprint)
  values (v_name, v_phone, v_email, v_property, v_ref, v_msg, v_pref, true,
          (select inquiry_consent_text from public.agency_settings where id = 1), 'site_web', v_fp)
  returning reference into v_reference;

  return jsonb_build_object('ok', true, 'reference', v_reference);
end $$;

revoke execute on function public.submit_inquiry(text, text, text, text, text, text, boolean, text) from public;
grant execute on function public.submit_inquiry(text, text, text, text, text, text, boolean, text) to anon, authenticated;

-- Conversion d'une demande en prospect (RLS de l'appelant appliquée).
create or replace function public.convert_inquiry_to_buyer(p_inquiry_id uuid, p_existing_buyer uuid default null)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  i public.inquiries;
  v_buyer uuid := p_existing_buyer;
  v_parts text[];
begin
  if not public.can_sales() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select * into i from public.inquiries where id = p_inquiry_id for update;
  if not found then
    raise exception 'Demande introuvable';
  end if;
  if v_buyer is null then
    v_parts := regexp_split_to_array(i.full_name, '\s+');
    insert into public.buyers (last_name, first_names, phone, email, source, contact_preference,
                               consent_contact, consent_date, status, notes)
    values (v_parts[1], nullif(array_to_string(v_parts[2:], ' '), ''), i.phone, i.email,
            'Site web', i.contact_preference, i.consent, i.created_at, 'a_contacter',
            'Créé depuis la demande ' || i.reference)
    returning id into v_buyer;
  end if;
  update public.inquiries set buyer_id = v_buyer, status = 'converti', handled_by = auth.uid()
   where id = i.id;
  insert into public.interactions (buyer_id, property_id, inquiry_id, channel, direction, occurred_at, summary)
  values (v_buyer, i.property_id, i.id, 'autre', 'entrant', i.created_at,
          'Demande ' || i.reference || ' : ' || left(i.message, 500));
  return v_buyer;
end $$;
revoke execute on function public.convert_inquiry_to_buyer(uuid, uuid) from public, anon;

-- ---------------------------------------------------------------------
-- Commissions
-- ---------------------------------------------------------------------
create or replace function public.estimate_commission(
  p_base numeric, p_calc public.commission_calc, p_rate numeric, p_fixed numeric, p_min numeric default null
) returns numeric
language sql immutable set search_path = '' as $$
  select case
    when p_base is null or p_calc is null then null
    when p_calc = 'fixe' then p_fixed
    when p_calc = 'pourcentage' then greatest(round(p_base * coalesce(p_rate, 0) / 100), coalesce(p_min, 0))
    else null
  end
$$;

-- Synthèse par transaction : estimée / convenue / exigible / encaissée / solde.
create view public.transaction_commissions with (security_invoker = true) as
  select t.id as transaction_id, t.reference, t.status, t.property_id, t.buyer_id,
         coalesce(t.agreed_price, t.initial_asking_price) as base_price,
         coalesce(
           public.estimate_commission(coalesce(t.agreed_price, t.initial_asking_price),
                                      r.calc_type, r.rate_percent, r.fixed_amount, r.min_amount),
           public.estimate_commission(coalesce(t.agreed_price, t.initial_asking_price),
                                      m.commission_calc, m.commission_rate_percent, m.commission_fixed_amount)
         ) as commission_estimated,
         t.commission_agreed,
         coalesce(f.expected, 0) as commission_due,
         coalesce(f.received, 0) as commission_received,
         coalesce(f.expected, 0) - coalesce(f.received, 0) as commission_balance
    from public.transactions t
    left join public.commission_rules r on r.id = t.commission_rule_id
    left join public.mandates m on m.id = t.mandate_id
    left join lateral (
      select sum(fe.amount_expected) filter (where fe.status in ('exigible', 'partiel', 'encaisse')) as expected,
             sum(fe.amount_received) as received
        from public.financial_entries fe
       where fe.transaction_id = t.id and fe.entry_type = 'commission' and fe.status <> 'annule'
    ) f on true;
grant select on public.transaction_commissions to authenticated;
revoke all on public.transaction_commissions from anon;

-- ---------------------------------------------------------------------
-- Tableau de bord (droits de l'appelant ; sections financières masquées sinon)
-- ---------------------------------------------------------------------
create or replace function public.dashboard_stats(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_from timestamptz := coalesce(p_from, date_trunc('month', now() at time zone 'Africa/Abidjan')::date)::timestamp at time zone 'Africa/Abidjan';
  v_to timestamptz := (coalesce(p_to, (now() at time zone 'Africa/Abidjan')::date) + 1)::timestamp at time zone 'Africa/Abidjan';
  v jsonb := '{}'::jsonb;
begin
  if not public.is_staff() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  v := v || jsonb_build_object('period', jsonb_build_object('from', v_from, 'to', v_to));

  v := v || jsonb_build_object('properties', (
    select jsonb_build_object(
      'total', count(*) filter (where commercial_status <> 'archive'),
      'disponibles', count(*) filter (where commercial_status in ('disponible', 'publie')),
      'publies', count(*) filter (where public.is_public_status(commercial_status)),
      'a_verifier', count(*) filter (where commercial_status = 'a_verifier' or (verification_status <> 'verifie' and commercial_status not in ('vendu', 'archive', 'retire'))),
      'en_negociation', count(*) filter (where commercial_status in ('sous_negociation', 'reserve')),
      'vendus', count(*) filter (where commercial_status = 'vendu'),
      'archives', count(*) filter (where commercial_status = 'archive'),
      'brouillons', count(*) filter (where commercial_status = 'brouillon'))
    from public.properties));

  if public.can_sales() then
    v := v || jsonb_build_object(
      'owners', (select count(*) from public.owners where archived_at is null),
      'prospects', (select count(*) from public.buyers where status not in ('converti', 'sans_suite', 'archive')),
      'inquiries_new', (select count(*) from public.inquiries where status = 'nouveau'),
      'visits_upcoming', (select count(*) from public.visits where scheduled_at >= now() and status in ('a_confirmer', 'confirmee')),
      'follow_ups_due', (select count(*) from public.buyers where next_follow_up_at <= now() and status not in ('converti', 'sans_suite', 'archive')));
  end if;

  v := v || jsonb_build_object(
    'tasks_overdue', (select count(*) from public.tasks where due_at < now() and status in ('a_faire', 'en_cours', 'reportee')),
    'tasks_today', (select count(*) from public.tasks
                     where (due_at at time zone 'Africa/Abidjan')::date = (now() at time zone 'Africa/Abidjan')::date
                       and status in ('a_faire', 'en_cours', 'reportee')));

  if public.can_sales() or public.can_finance() then
    v := v || jsonb_build_object(
      'transactions_open', (select count(*) from public.transactions
                             where status in ('negociation', 'offre_en_attente', 'offre_acceptee_sous_conditions', 'dossier_en_cours')),
      'negotiations_pending', (select count(*) from public.negotiations where status = 'en_attente'),
      'sales', (select jsonb_build_object('count', count(*), 'volume', coalesce(sum(agreed_price), 0))
                  from public.transactions
                 where status = 'vente_conclue'
                   and concluded_date >= (v_from at time zone 'Africa/Abidjan')::date
                   and concluded_date < (v_to at time zone 'Africa/Abidjan')::date));
  end if;

  if public.can_finance() then
    v := v || jsonb_build_object('finance', jsonb_build_object(
      'commissions_estimated', (select coalesce(sum(commission_estimated), 0) from public.transaction_commissions
                                 where status in ('negociation', 'offre_en_attente', 'offre_acceptee_sous_conditions', 'dossier_en_cours')),
      'commissions_agreed', (select coalesce(sum(commission_agreed), 0) from public.transactions
                              where status not in ('annulee', 'abandonnee')),
      'commissions_due_balance', (select coalesce(sum(balance), 0) from public.financial_entries
                                   where entry_type = 'commission' and status in ('exigible', 'partiel')),
      'commissions_received', (select coalesce(sum(pa.amount), 0) from public.payments pa
                                 join public.financial_entries fe on fe.id = pa.financial_entry_id
                                where fe.entry_type = 'commission'
                                  and pa.paid_on >= (v_from at time zone 'Africa/Abidjan')::date
                                  and pa.paid_on < (v_to at time zone 'Africa/Abidjan')::date),
      'revenue_received', (select coalesce(sum(amount), 0) from public.payments
                            where paid_on >= (v_from at time zone 'Africa/Abidjan')::date
                              and paid_on < (v_to at time zone 'Africa/Abidjan')::date),
      'expenses', (select coalesce(sum(amount), 0) from public.expenses
                    where expense_date >= (v_from at time zone 'Africa/Abidjan')::date
                      and expense_date < (v_to at time zone 'Africa/Abidjan')::date)));
    v := jsonb_set(v, '{finance,result}',
      to_jsonb((v #>> '{finance,revenue_received}')::numeric - (v #>> '{finance,expenses}')::numeric));
  end if;

  return v;
end $$;
revoke execute on function public.dashboard_stats(date, date) from public, anon;

-- Rapport financier détaillé sur une période.
create or replace function public.finance_report(p_from date, p_to date)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v jsonb;
begin
  if not public.can_finance() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Période invalide' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'revenues_expected', (select coalesce(sum(amount_expected), 0) from public.financial_entries
                           where status <> 'annule' and entry_date between p_from and p_to),
    'revenues_received', (select coalesce(sum(amount), 0) from public.payments where paid_on between p_from and p_to),
    'revenues_by_type', (select coalesce(jsonb_agg(x order by x.entry_type), '[]'::jsonb) from (
        select fe.entry_type, sum(fe.amount_expected) as expected, sum(fe.amount_received) as received, sum(fe.balance) as balance
          from public.financial_entries fe
         where fe.status <> 'annule' and fe.entry_date between p_from and p_to
         group by fe.entry_type) x),
    'commissions_due', (select coalesce(sum(balance), 0) from public.financial_entries
                         where entry_type = 'commission' and status in ('exigible', 'partiel')),
    'commissions_received', (select coalesce(sum(pa.amount), 0) from public.payments pa
                               join public.financial_entries fe on fe.id = pa.financial_entry_id
                              where fe.entry_type = 'commission' and pa.paid_on between p_from and p_to),
    'expenses_total', (select coalesce(sum(amount), 0) from public.expenses where expense_date between p_from and p_to),
    'expenses_by_category', (select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) from (
        select category, sum(amount) as total, count(*) as count
          from public.expenses where expense_date between p_from and p_to group by category) x)
  ) into v;
  v := v || jsonb_build_object('result',
    (v ->> 'revenues_received')::numeric - (v ->> 'expenses_total')::numeric);
  return v;
end $$;
revoke execute on function public.finance_report(date, date) from public, anon;

-- Biens correspondant aux critères d'un prospect.
create or replace function public.property_matches(p_buyer_id uuid)
returns setof public.properties
language sql stable security invoker set search_path = '' as $$
  select p.* from public.properties p, public.buyers b
   where b.id = p_buyer_id
     and p.commercial_status in ('disponible', 'publie')
     and (b.budget_max is null or p.price_xof <= b.budget_max)
     and (b.budget_min is null or p.price_xof >= b.budget_min)
     and (cardinality(b.property_types) = 0 or p.property_type = any (b.property_types))
     and (cardinality(b.zones) = 0 or exists (
           select 1 from unnest(b.zones) z
            where lower(p.city) = lower(z) or lower(coalesce(p.district, '')) = lower(z)))
     and (b.area_min is null or p.area >= b.area_min)
     and (b.bedrooms_min is null or coalesce(p.bedrooms, 0) >= b.bedrooms_min)
   order by p.published_at desc nulls last
   limit 50
$$;
revoke execute on function public.property_matches(uuid) from public, anon;

-- Fonctions utilitaires réservées à l'équipe.
revoke execute on function public.estimate_commission(numeric, public.commission_calc, numeric, numeric, numeric) from anon;
