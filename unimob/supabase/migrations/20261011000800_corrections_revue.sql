-- =====================================================================
-- 0008 — Corrections issues de la relecture des corrections d'audit
--        (11 octobre 2026).
-- S'applique après 0001-0007 (installation neuve ou projet existant).
-- Rejouable : fonctions remplacées, déclencheurs recréés.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Auteur verrouillé (created_by…), sans bloquer la suppression d'un
--    compte : la mise à NULL faite par la clé étrangère (ON DELETE SET
--    NULL, profil supprimé) passe ; toute autre modification est annulée.
-- ---------------------------------------------------------------------
create or replace function public.tg_lock_author() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_col text := tg_argv[0];
  v_old text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new := jsonb_populate_record(new, jsonb_build_object(v_col, auth.uid()));
    end if;
    return new;
  end if;
  v_old := to_jsonb(old) ->> v_col;
  if to_jsonb(new) ->> v_col is null and v_old is not null
     and not exists (select 1 from public.profiles where id = v_old::uuid) then
    return new;
  end if;
  new := jsonb_populate_record(new, jsonb_build_object(v_col, to_jsonb(old) -> v_col));
  return new;
end $$;
revoke execute on function public.tg_lock_author() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Anonymisation : le journal d'activité est expurgé lui aussi
--    (fiche, demandes, échanges même supprimés, visites, tâches…),
--    y compris les lignes écrites par l'anonymisation elle-même.
-- ---------------------------------------------------------------------
-- Ne garde que les valeurs techniques (identifiants, référence, statut, dates système).
create or replace function public.log_mask(j jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(j) = 'object' then
    (select coalesce(jsonb_object_agg(e.key,
              case when e.key in ('id', 'reference', 'status', 'created_at', 'updated_at') or e.key ~ '_(id|by)$'
                   then e.value else to_jsonb('[anonymisé]'::text) end), '{}'::jsonb)
       from jsonb_each(j) e)
  else j end
$$;
revoke execute on function public.log_mask(jsonb) from public, anon, authenticated;

-- Résumé d'une entrée : une référence (BIEN-2026-00001) est gardée ; un titre ou un courriel est masqué.
create or replace function public.log_mask_summary(p text) returns text
language sql immutable set search_path = '' as $$
  select case when p is null or p ~ '^[A-Z0-9]+(-[A-Z0-9]+)+$' then p else '[anonymisé]' end
$$;
revoke execute on function public.log_mask_summary(text) from public, anon, authenticated;

-- p_entity : 'buyers' ou 'owners' ; p_linked : tables liées par buyer_id / owner_id.
create or replace function public.log_scrub_person(p_entity text, p_id uuid, p_linked text[]) returns void
language plpgsql set search_path = '' as $$
declare
  v_key text := case p_entity when 'buyers' then 'buyer_id' when 'owners' then 'owner_id' end;
  v_ids uuid[];
  t text;
begin
  update public.activity_logs set changes = public.log_mask(changes), summary = public.log_mask_summary(summary)
   where entity_type = p_entity and entity_id = p_id and changes is not null;
  foreach t in array p_linked loop
    execute format('select coalesce(array_agg(id), ''{}'') from public.%I where %I = $1', t, v_key)
      into v_ids using p_id;
    -- Lignes supprimées ou rattachées depuis à une autre fiche : retrouvées par le journal.
    v_ids := v_ids || array(
      select distinct l.entity_id from public.activity_logs l
       where l.entity_type = t and l.entity_id is not null
         and p_id::text in (l.changes ->> v_key, l.changes -> v_key ->> 'avant', l.changes -> v_key ->> 'apres'));
    update public.activity_logs set changes = public.log_mask(changes), summary = public.log_mask_summary(summary)
     where entity_type = t and entity_id = any (v_ids) and changes is not null;
  end loop;
end $$;
revoke execute on function public.log_scrub_person(text, uuid, text[]) from public, anon, authenticated;

create or replace function public.anonymize_buyer(p_buyer_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_ref text;
begin
  if not public.is_admin() then
    raise exception 'Réservé à l''administrateur' using errcode = '42501';
  end if;
  update public.buyers
     set last_name = 'ANONYMISÉ', first_names = null, phone = '000000', email = null, notes = null,
         zones = '{}', project_timeline = null, consent_contact = false, consent_marketing = false,
         next_follow_up_at = null, status = 'archive'
   where id = p_buyer_id
   returning reference into v_ref;
  if v_ref is null then
    raise exception 'Prospect introuvable';
  end if;
  update public.interactions set summary = '[anonymisé]', next_action = null where buyer_id = p_buyer_id;
  update public.inquiries set full_name = 'Anonymisé', phone = '000000', email = null, message = '[anonymisé]'
   where buyer_id = p_buyer_id;
  update public.visits set report = null, objections = null, notes = null, next_action = null where buyer_id = p_buyer_id;
  update public.tasks set title = 'Tâche (personne anonymisée)', description = null, result = null, next_action = null
   where buyer_id = p_buyer_id;
  insert into public.activity_logs (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), 'anonymisation', 'buyers', p_buyer_id, v_ref);
  perform public.log_scrub_person('buyers', p_buyer_id, array['inquiries', 'interactions', 'visits', 'tasks']);
end $$;

create or replace function public.anonymize_owner(p_owner_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_ref text;
begin
  if not public.is_admin() then
    raise exception 'Réservé à l''administrateur' using errcode = '42501';
  end if;
  update public.owners
     set last_name = 'ANONYMISÉ', first_names = null, phone_primary = '000000', phone_secondary = null,
         email = null, address = null, locality = null, notes = null, archived_at = coalesce(archived_at, now())
   where id = p_owner_id
   returning reference into v_ref;
  if v_ref is null then
    raise exception 'Propriétaire introuvable';
  end if;
  update public.interactions set summary = '[anonymisé]', next_action = null where owner_id = p_owner_id;
  update public.document_checks set comment = null, doc_reference = null where owner_id = p_owner_id;
  update public.tasks set title = 'Tâche (personne anonymisée)', description = null, result = null, next_action = null
   where owner_id = p_owner_id;
  insert into public.activity_logs (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), 'anonymisation', 'owners', p_owner_id, v_ref);
  perform public.log_scrub_person('owners', p_owner_id, array['interactions', 'document_checks', 'tasks']);
end $$;

-- ---------------------------------------------------------------------
-- 3. Preuve de consentement non falsifiable.
--    Demandes : le texte accepté sur le site (submit_inquiry) est conservé,
--    même pour un membre connecté ; une saisie de l'équipe est attribuée
--    (nom et courriel), figée ensuite, et jamais présentée comme venant du site.
--    Prospects : la date d'accord est fixée par la base.
-- ---------------------------------------------------------------------
create or replace function public.submit_inquiry(
  p_full_name text,
  p_phone text,
  p_message text,
  p_email text default null,
  p_property_reference text default null,
  p_contact_preference text default 'telephone',
  p_consent boolean default false,
  p_website text default null
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
  v_phone_norm text;
  v_headers jsonb;
  v_reference text;
begin
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

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  -- Empreinte HMAC avec un secret privé : l'IP n'est ni stockée ni recalculable.
  v_fp := encode(extensions.hmac(
            convert_to(coalesce(v_headers ->> 'cf-connecting-ip', split_part(v_headers ->> 'x-forwarded-for', ',', 1), 'inconnu'), 'UTF8'),
            (select secret from private.app_secret where id = 1), 'sha256'), 'hex');
  v_phone_norm := coalesce(public.normalize_phone(v_phone), v_phone);

  -- Sérialise les envois concurrents d'une même source (sinon la limite se contourne).
  perform pg_advisory_xact_lock(hashtext('inq-fp:' || v_fp));
  perform pg_advisory_xact_lock(hashtext('inq-ph:' || v_phone_norm));

  if (select count(*) from private.inquiry_throttle
       where phone_norm = v_phone_norm and created_at > now() - interval '15 minutes') >= 3 then
    raise exception 'Trop de demandes envoyées. Merci de réessayer plus tard.' using errcode = '54000';
  end if;
  if (select count(*) from private.inquiry_throttle
       where fingerprint = v_fp and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Trop de demandes envoyées. Merci de réessayer plus tard.' using errcode = '54000';
  end if;

  delete from private.inquiry_throttle where created_at < now() - interval '2 days';
  insert into private.inquiry_throttle (fingerprint, phone_norm) values (v_fp, v_phone_norm);

  if v_ref is not null then
    select id into v_property from public.public_properties
     where reference = v_ref and not is_demo;
  end if;

  -- Indicateur local lu par tg_inquiry_consent : envoi du formulaire public, texte accepté conservé.
  perform set_config('unimob.public_submit', '1', true);
  insert into public.inquiries (full_name, phone, email, property_id, property_reference_input,
                                message, contact_preference, consent, consent_text, source)
  values (v_name, v_phone, v_email, v_property, v_ref, v_msg, v_pref, true,
          (select inquiry_consent_text from public.agency_settings where id = 1), 'site_web')
  returning reference into v_reference;
  perform set_config('unimob.public_submit', '', true);

  return jsonb_build_object('ok', true, 'reference', v_reference);
end $$;
revoke execute on function public.submit_inquiry(text, text, text, text, text, text, boolean, text) from public;
grant execute on function public.submit_inquiry(text, text, text, text, text, text, boolean, text) to anon, authenticated;

create or replace function public.tg_inquiry_consent() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_who text;
begin
  -- Session serveur, ou envoi du formulaire public : rien n'est réécrit.
  if auth.uid() is null or (tg_op = 'INSERT' and current_setting('unimob.public_submit', true) = '1') then
    return new;
  end if;
  -- Date de réception fixée par la base (elle date l'accord lors de la conversion en prospect).
  new.created_at := case when tg_op = 'INSERT' then now() else old.created_at end;
  if new.source = 'site_web' and (tg_op = 'INSERT' or old.source is distinct from 'site_web') then
    raise exception 'Une demande saisie par l''équipe ne peut pas avoir le canal « Site web »' using errcode = '42501';
  end if;
  if not new.consent then
    new.consent_text := null;
  elsif tg_op = 'UPDATE' and old.consent then
    -- Accord déjà enregistré : la preuve n'est plus modifiable.
    new.consent_text := old.consent_text;
  else
    select case when nullif(btrim(p.full_name), '') is null then p.email
                when p.email is null then btrim(p.full_name)
                else btrim(p.full_name) || ' (' || p.email || ')' end
      into v_who from public.profiles p where p.id = auth.uid();
    new.consent_text := 'Accord déclaré par ' || coalesce(v_who, 'un membre de l''équipe') ||
      ' le ' || to_char(now() at time zone 'Africa/Abidjan', 'DD/MM/YYYY HH24:MI') || ' (saisie interne)';
  end if;
  return new;
end $$;
revoke execute on function public.tg_inquiry_consent() from public, anon, authenticated;
drop trigger if exists inquiries_consent on public.inquiries;
create trigger inquiries_consent before insert or update on public.inquiries
  for each row execute function public.tg_inquiry_consent();

create or replace function public.tg_buyer_consent_date() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not (new.consent_contact or new.consent_marketing) then
    new.consent_date := null;
  elsif auth.uid() is null then
    -- Session serveur (reprise de données) : date fournie conservée, jamais dans le futur.
    new.consent_date := least(coalesce(new.consent_date, now()), now());
  elsif tg_op = 'INSERT' and coalesce(current_setting('unimob.consent_from_inquiry', true), '') <> '' then
    -- Conversion d'une demande du site (convert_inquiry_to_buyer) : date de l'envoi du formulaire.
    new.consent_date := least(current_setting('unimob.consent_from_inquiry', true)::timestamptz, now());
  elsif tg_op = 'UPDATE' and (old.consent_contact or old.consent_marketing) then
    new.consent_date := coalesce(old.consent_date, now());
  else
    new.consent_date := now();
  end if;
  return new;
end $$;
revoke execute on function public.tg_buyer_consent_date() from public, anon, authenticated;

-- Conversion d'une demande : identique à 0007, mais la date d'accord du prospect est celle de
-- l'envoi du formulaire du site (indicateur local lu par tg_buyer_consent_date).
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
  if i.buyer_id is not null then
    raise exception 'Cette demande est déjà rattachée à un prospect' using errcode = '23514';
  end if;
  if v_buyer is null then
    v_parts := regexp_split_to_array(i.full_name, '\s+');
    perform set_config('unimob.consent_from_inquiry',
                       case when i.consent and i.source = 'site_web' then i.created_at::text else '' end, true);
    insert into public.buyers (last_name, first_names, phone, email, source, contact_preference,
                               consent_contact, consent_date, status, notes)
    values (v_parts[1], nullif(array_to_string(v_parts[2:], ' '), ''), i.phone, i.email,
            case i.source when 'site_web' then 'Site web' when 'whatsapp' then 'WhatsApp'
                          when 'telephone' then 'Téléphone' else 'Autre' end,
            i.contact_preference, i.consent, case when i.consent then i.created_at end, 'a_contacter',
            'Créé depuis la demande ' || i.reference)
    returning id into v_buyer;
    perform set_config('unimob.consent_from_inquiry', '', true);
  elsif not exists (select 1 from public.buyers where id = v_buyer) then
    raise exception 'Prospect introuvable';
  end if;
  update public.inquiries set buyer_id = v_buyer, status = 'converti', handled_by = auth.uid()
   where id = i.id;
  insert into public.interactions (buyer_id, property_id, inquiry_id, channel, direction, occurred_at, summary)
  values (v_buyer, i.property_id, i.id,
          case i.source when 'whatsapp' then 'whatsapp' when 'telephone' then 'appel' else 'autre' end::public.interaction_channel,
          'entrant', i.created_at, 'Demande ' || i.reference || ' : ' || left(i.message, 500));
  return v_buyer;
end $$;
revoke execute on function public.convert_inquiry_to_buyer(uuid, uuid) from public, anon;
grant execute on function public.convert_inquiry_to_buyer(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Commission d'un dossier conclu : l'écriture unique suit la commission
--    convenue, sans descendre sous l'encaissé. Si la commission est répartie
--    sur plusieurs écritures, l'ajustement reste manuel (comptable).
-- ---------------------------------------------------------------------
create or replace function public.align_commission_entry(p_transaction_id uuid, p_amount numeric) returns void
language plpgsql set search_path = '' as $$
begin
  if p_amount is null or (select count(*) from public.financial_entries
       where transaction_id = p_transaction_id and entry_type = 'commission' and status <> 'annule') <> 1 then
    return;
  end if;
  update public.financial_entries
     set amount_expected = greatest(p_amount, amount_received),
         status = (case when amount_received = 0 then 'exigible'
                        when amount_received < p_amount then 'partiel'
                        else 'encaisse' end)::public.revenue_status
   where transaction_id = p_transaction_id and entry_type = 'commission' and status <> 'annule';
end $$;
revoke execute on function public.align_commission_entry(uuid, numeric) from public, anon, authenticated;

create or replace function public.tg_transaction_commission_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'vente_conclue' and new.commission_agreed is not null
     and new.commission_agreed is distinct from old.commission_agreed then
    perform public.align_commission_entry(new.id, new.commission_agreed);
  end if;
  return new;
end $$;
revoke execute on function public.tg_transaction_commission_sync() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Conclusion, annulation, abandon : commission alignée, offres closes.
-- ---------------------------------------------------------------------
create or replace function public.tg_transaction_effects() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_open public.transaction_status[] := array['negociation', 'offre_en_attente', 'offre_acceptee_sous_conditions', 'dossier_en_cours']::public.transaction_status[];
  v_amount numeric;
  v_count int;
  v_single numeric;
  v_today date := public.agency_today();
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  -- Réouverture d'une vente conclue (administrateur) : on défait ses effets.
  if tg_op = 'UPDATE' and old.status = 'vente_conclue' then
    if exists (select 1 from public.financial_entries f
                where f.transaction_id = new.id and f.entry_type = 'commission' and f.amount_received <> 0) then
      raise exception 'Des encaissements de commission existent : saisissez d''abord une correction ramenant l''encaissé à 0'
        using errcode = '23514';
    end if;
    update public.financial_entries
       set status = 'annule', notes = concat_ws(' ', notes, '— Annulée : réouverture de ' || new.reference)
     where transaction_id = new.id and entry_type = 'commission' and status in ('prevu', 'exigible');
    update public.properties
       set commercial_status = 'disponible', unavailability_reason = null
     where id = new.property_id and commercial_status = 'vendu';
    update public.mandates set status = 'actif'
     where id = (select m.id from public.mandates m
                  where m.property_id = new.property_id and m.status = 'cloture'
                    and m.signed_date <= v_today and (m.end_date is null or m.end_date >= v_today)
                  order by m.updated_at desc limit 1)
       and not exists (select 1 from public.mandates m2 where m2.property_id = new.property_id and m2.status = 'actif');
  end if;

  if new.status = 'vente_conclue' then
    update public.properties
       set commercial_status = 'vendu', unavailability_reason = 'Vendu (' || new.reference || ')'
     where id = new.property_id;
    update public.buyers set status = 'converti' where id = new.buyer_id and status <> 'archive';
    update public.mandates set status = 'cloture'
     where property_id = new.property_id and status = 'actif';
    -- Les autres dossiers ouverts sur ce bien sont clos (un bien ne se vend qu'une fois) ;
    -- leurs offres en attente expirent (branche « annulee » ci-dessous).
    update public.transactions
       set status = 'annulee', abandon_reason = 'Bien vendu via ' || new.reference
     where property_id = new.property_id and id <> new.id and status = any (v_open);
    -- Commission : les écritures prévues deviennent exigibles, même à 0 FCFA (montant aligné ensuite).
    update public.financial_entries
       set status = 'exigible', entry_date = coalesce(new.concluded_date, entry_date)
     where transaction_id = new.id and entry_type = 'commission' and status = 'prevu';
    select count(*), max(amount_expected) into v_count, v_single
      from public.financial_entries
     where transaction_id = new.id and entry_type = 'commission' and status <> 'annule';
    if v_count = 0 then
      select coalesce(new.commission_agreed, tc.commission_estimated, 0) into v_amount
        from public.transaction_commissions tc where tc.transaction_id = new.id;
      v_amount := coalesce(v_amount, new.commission_agreed, 0);
      insert into public.financial_entries (entry_date, entry_type, transaction_id, amount_expected, status, notes)
      values (coalesce(new.concluded_date, v_today), 'commission', new.id, v_amount,
              (case when v_amount > 0 then 'exigible' else 'prevu' end)::public.revenue_status,
              case when new.commission_agreed is null
                   then 'Montant estimé selon la règle de commission, à confirmer. ' else '' end
              || 'Créée automatiquement à la conclusion de ' || new.reference);
    elsif v_count = 1 then
      -- Écriture unique : alignée sur la commission convenue, sinon (si elle est à 0) sur l'estimation.
      if new.commission_agreed is not null then
        perform public.align_commission_entry(new.id, new.commission_agreed);
      elsif v_single = 0 then
        select tc.commission_estimated into v_amount
          from public.transaction_commissions tc where tc.transaction_id = new.id;
        if coalesce(v_amount, 0) > 0 then
          perform public.align_commission_entry(new.id, v_amount);
          update public.financial_entries
             set notes = concat_ws(' ', notes, 'Montant estimé selon la règle de commission, à confirmer.')
           where transaction_id = new.id and entry_type = 'commission' and status <> 'annule';
        end if;
      end if;
    end if;
    -- Offres restées en attente sur le dossier conclu.
    update public.negotiations set status = 'expiree'
     where transaction_id = new.id and status = 'en_attente';
  elsif new.status = any (v_open) then
    update public.properties set commercial_status = 'sous_negociation'
     where id = new.property_id and commercial_status = 'publie';
  elsif new.status in ('annulee', 'abandonnee') then
    update public.negotiations set status = 'expiree'
     where transaction_id = new.id and status = 'en_attente';
    -- Sans autre dossier actif, le bien redevient publié s'il est conforme, sinon disponible.
    if not exists (
      select 1 from public.transactions t
       where t.property_id = new.property_id and t.id <> new.id and t.status = any (v_open)
    ) then
      update public.properties as p
         set commercial_status = (case when cardinality(public.publication_blockers_row(p)) = 0
                                       then 'publie' else 'disponible' end)::public.property_status,
             unavailability_reason = case when p.commercial_status = 'reserve' then null else p.unavailability_reason end
       where p.id = new.property_id and p.commercial_status in ('sous_negociation', 'reserve');
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.tg_transaction_effects() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Changement de propriétaire : refusé dès qu'un mandat en vigueur ou en
--    attente, ou un dossier ouvert, concerne un autre propriétaire (même si
--    le bien n'en avait pas). Un dossier clôturé reste modifiable ensuite.
-- ---------------------------------------------------------------------
create or replace function public.tg_property_publication() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_blockers text[];
begin
  if tg_op = 'UPDATE' then
    -- Les dates de publication ne sont jamais fixées par le client.
    new.published_at := old.published_at;
    new.unpublished_at := old.unpublished_at;
    if old.commercial_status in ('vendu', 'archive')
       and new.commercial_status is distinct from old.commercial_status
       and auth.uid() is not null and not public.is_admin() then
      raise exception 'Seul un administrateur peut remettre en vente un bien vendu ou archivé' using errcode = '42501';
    end if;
    if new.owner_id is distinct from old.owner_id and (
      exists (select 1 from public.mandates m
               where m.property_id = new.id and m.status in ('actif', 'en_attente_signature')
                 and m.owner_id is distinct from new.owner_id)
      or exists (select 1 from public.transactions t
                  where t.property_id = new.id
                    and t.status in ('negociation', 'offre_en_attente', 'offre_acceptee_sous_conditions', 'dossier_en_cours')
                    and t.owner_id is distinct from new.owner_id)
    ) then
      raise exception 'Changement de propriétaire impossible : résiliez ou clôturez d''abord le mandat et les dossiers en cours'
        using errcode = '23514';
    end if;
  else
    new.published_at := null;
    new.unpublished_at := null;
  end if;

  if public.is_public_status(new.commercial_status)
     and (tg_op = 'INSERT' or not public.is_public_status(old.commercial_status)) then
    if tg_op = 'INSERT' then
      raise exception 'Un bien doit être créé puis publié après validation' using errcode = '23514';
    end if;
    if old.commercial_status in ('vendu', 'archive')
       or exists (select 1 from public.transactions t where t.property_id = new.id and t.status = 'vente_conclue') then
      raise exception 'Un bien vendu ou archivé ne peut pas être publié' using errcode = '23514';
    end if;
    v_blockers := public.publication_blockers_row(new);
    if array_length(v_blockers, 1) > 0 then
      raise exception 'Publication impossible : %', array_to_string(v_blockers, ' ; ') using errcode = '23514';
    end if;
    new.published_at := now();
    new.unpublished_at := null;
  elsif tg_op = 'UPDATE' and public.is_public_status(old.commercial_status)
        and not public.is_public_status(new.commercial_status) then
    new.unpublished_at := now();
  end if;
  if new.commercial_status = 'retire' and coalesce(btrim(new.unavailability_reason), '') = '' then
    raise exception 'Un motif d''indisponibilité est requis pour retirer un bien' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.tg_property_publication() from public, anon, authenticated;

create or replace function public.tg_transaction_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_status public.property_status;
begin
  select owner_id, commercial_status into v_owner, v_status from public.properties where id = new.property_id;
  -- Contrôle à la création, au changement de bien / vendeur et à la réouverture : un dossier
  -- clôturé reste modifiable (notes, commission) après un changement de propriétaire du bien,
  -- mais ne peut pas redevenir ouvert au nom de l'ancien propriétaire.
  if (tg_op = 'INSERT' or new.property_id is distinct from old.property_id or new.owner_id is distinct from old.owner_id
      or (old.status in ('vente_conclue', 'annulee', 'abandonnee')
          and new.status not in ('vente_conclue', 'annulee', 'abandonnee')))
     and v_owner is not null and v_owner <> new.owner_id then
    raise exception 'Le vendeur de la transaction ne correspond pas au propriétaire du bien' using errcode = '23514';
  end if;
  if new.mandate_id is not null and not exists (
    select 1 from public.mandates m where m.id = new.mandate_id and m.property_id = new.property_id
  ) then
    raise exception 'Le mandat ne concerne pas ce bien' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or new.property_id is distinct from old.property_id) and v_status in ('vendu', 'archive') then
    raise exception 'Impossible d''ouvrir un dossier sur un bien vendu ou archivé' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status in ('vente_conclue', 'annulee', 'abandonnee')
     and auth.uid() is not null and not public.is_admin() then
    if new.status is distinct from old.status then
      raise exception 'Seul un administrateur peut rouvrir un dossier clôturé' using errcode = '42501';
    end if;
    if (to_jsonb(new) - array['notes', 'supporting_docs_note', 'updated_at'])
       is distinct from (to_jsonb(old) - array['notes', 'supporting_docs_note', 'updated_at']) then
      raise exception 'Dossier clôturé : seules les notes peuvent être modifiées (administrateur pour le reste)'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.tg_transaction_rules() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Tableau de bord : commission convenue des dossiers ouverts comptée
--    une seule fois par bien (comme l'estimation).
-- ---------------------------------------------------------------------
create or replace function public.dashboard_stats(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_today date := public.agency_today();
  v_from_d date := coalesce(p_from, date_trunc('month', v_today)::date);
  v_to_d date := coalesce(p_to, v_today);
  v_open public.transaction_status[] := array['negociation', 'offre_en_attente', 'offre_acceptee_sous_conditions', 'dossier_en_cours']::public.transaction_status[];
  v jsonb := '{}'::jsonb;
begin
  if not public.is_staff() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if v_to_d < v_from_d then
    raise exception 'Période invalide' using errcode = '22023';
  end if;

  v := v || jsonb_build_object('period', jsonb_build_object('from', v_from_d, 'to', v_to_d));

  -- Les compteurs correspondent exactement aux filtres des listes liées.
  v := v || jsonb_build_object('properties', (
    select jsonb_build_object(
      'total', count(*) filter (where commercial_status <> 'archive'),
      'disponibles', count(*) filter (where commercial_status in ('disponible', 'publie')),
      'publies', count(*) filter (where public.is_public_status(commercial_status)),
      'a_verifier', count(*) filter (where verification_status <> 'verifie' and commercial_status <> 'archive'),
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
      'follow_ups_due', (select count(*) from public.buyers where next_follow_up_at <= now() and status not in ('converti', 'sans_suite', 'archive')),
      'mandate_reminders', (select count(*) from public.mandates
                             where status in ('actif', 'en_attente_signature')
                               and (reminder_date <= v_today or end_date <= v_today + 30)),
      'visit_follow_ups', (select count(*) from public.visits
                            where follow_up_at <= now() and follow_up_at > now() - interval '30 days'
                              and status not in ('annulee', 'sans_suite')));
  end if;

  v := v || jsonb_build_object(
    'tasks_overdue', (select count(*) from public.tasks where due_at < now() and status in ('a_faire', 'en_cours', 'reportee')),
    'tasks_today', (select count(*) from public.tasks
                     where (due_at at time zone 'Africa/Abidjan')::date = v_today
                       and status in ('a_faire', 'en_cours', 'reportee')));

  if public.can_sales() or public.can_finance() then
    v := v || jsonb_build_object(
      'transactions_open', (select count(*) from public.transactions where status = any (v_open)),
      'negotiations_pending', (select count(*) from public.negotiations where status = 'en_attente'),
      'sales', (select jsonb_build_object('count', count(*), 'volume', coalesce(sum(agreed_price), 0))
                  from public.transactions
                 where status = 'vente_conclue' and concluded_date between v_from_d and v_to_d));
  end if;

  if public.can_finance() then
    v := v || jsonb_build_object('finance', jsonb_build_object(
      -- Situation actuelle (toutes périodes)
      -- Un bien ne se vend qu'une fois : on retient le montant maximal par bien.
      'commissions_estimated', (select coalesce(sum(m), 0) from (
                                  select max(commission_estimated) as m from public.transaction_commissions
                                   where status = any (v_open) group by property_id) x),
      'commissions_agreed_open', (select coalesce(sum(m), 0) from (
                                    select max(commission_agreed) as m from public.transactions
                                     where status = any (v_open) group by property_id) x),
      'commissions_due_balance', (select coalesce(sum(balance), 0) from public.financial_entries
                                   where entry_type = 'commission' and status in ('exigible', 'partiel')),
      -- Période sélectionnée
      'commissions_agreed', (select coalesce(sum(commission_agreed), 0) from public.transactions
                              where status = 'vente_conclue' and concluded_date between v_from_d and v_to_d),
      'commissions_received', (select coalesce(sum(pa.amount), 0) from public.payments pa
                                 join public.financial_entries fe on fe.id = pa.financial_entry_id
                                where fe.entry_type = 'commission' and pa.paid_on between v_from_d and v_to_d),
      'revenue_received', (select coalesce(sum(amount), 0) from public.payments where paid_on between v_from_d and v_to_d),
      'expenses', (select coalesce(sum(amount), 0) from public.expenses where expense_date between v_from_d and v_to_d)));
    v := jsonb_set(v, '{finance,result}',
      to_jsonb((v #>> '{finance,revenue_received}')::numeric - (v #>> '{finance,expenses}')::numeric));
  end if;

  return v;
end $$;
revoke execute on function public.dashboard_stats(date, date) from public, anon;
grant execute on function public.dashboard_stats(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Identité dans le journal : le nom du compte n'est modifiable que par
--    l'administrateur ; publication et dépublication déclarées seulement
--    par un membre commercial, sur un bien existant.
-- ---------------------------------------------------------------------
create or replace function public.tg_profiles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() = 1 and auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
      raise exception 'Seul un administrateur peut modifier le rôle ou l''activation d''un compte'
        using errcode = '42501';
    end if;
    if new.email is distinct from old.email then
      raise exception 'Le courriel du profil est synchronisé avec le compte et ne peut pas être modifié ici'
        using errcode = '42501';
    end if;
    if new.full_name is distinct from old.full_name then
      raise exception 'Seul un administrateur peut modifier le nom d''un compte' using errcode = '42501';
    end if;
  end if;
  if old.id = auth.uid() and old.role = 'admin'
     and (new.role is distinct from 'admin' or not new.is_active) then
    raise exception 'Un administrateur ne peut pas retirer ses propres droits' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.tg_profiles_guard() from public, anon, authenticated;

create or replace function public.log_event(p_action text, p_entity_type text, p_entity_id uuid, p_summary text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  -- Seules les actions non couvertes par les déclencheurs peuvent être déclarées.
  if p_action not in ('export_csv', 'export_pdf', 'consultation_document', 'publication', 'depublication') then
    raise exception 'Action de journal non autorisée' using errcode = '22023';
  end if;
  if p_action in ('publication', 'depublication')
     and (not public.can_sales() or p_entity_type is distinct from 'properties'
          or not exists (select 1 from public.properties where id = p_entity_id)) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  insert into public.activity_logs (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), p_action, left(p_entity_type, 60), p_entity_id, left(p_summary, 500));
end $$;
revoke execute on function public.log_event(text, text, uuid, text) from public, anon;
grant execute on function public.log_event(text, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Dossier clôturé : ses offres ne sont plus ajoutées ni modifiées
--    (sauf les notes) hors administrateur. Les mises à jour faites par les
--    déclencheurs (offres expirées à la clôture) ne sont pas concernées.
-- ---------------------------------------------------------------------
create or replace function public.tg_negotiation_closed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() = 1 and auth.uid() is not null and not public.is_admin()
     and exists (select 1 from public.transactions t
                  where t.id in (new.transaction_id, case when tg_op = 'UPDATE' then old.transaction_id end)
                    and t.status in ('vente_conclue', 'annulee', 'abandonnee'))
     and (tg_op = 'INSERT'
          or (to_jsonb(new) - array['notes', 'updated_at']) is distinct from (to_jsonb(old) - array['notes', 'updated_at'])) then
    raise exception 'Dossier clôturé : les offres ne peuvent plus être ajoutées ni modifiées (seules les notes)'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.tg_negotiation_closed() from public, anon, authenticated;
drop trigger if exists negotiations_closed on public.negotiations;
create trigger negotiations_closed before insert or update on public.negotiations
  for each row execute function public.tg_negotiation_closed();

-- ---------------------------------------------------------------------
-- 10. Droits complémentaires.
--     unaccent est appelée avec les droits du visiteur (vue public_properties)
--     et du membre (property_matches) : sur un projet qui retire EXECUTE par
--     défaut, le catalogue du site serait hors service sans ce droit explicite.
--     (Si le rôle courant n'a pas l'option d'octroi, PostgreSQL n'émet qu'un
--     avertissement : la fonction garde alors les droits accordés par Supabase.)
--     Aucune séquence n'est utile au visiteur (ses envois passent par
--     submit_inquiry).
-- ---------------------------------------------------------------------
grant execute on function extensions.unaccent(text) to anon, authenticated, service_role;
revoke all on all sequences in schema public from anon;
