-- =====================================================================
-- 0007 — Corrections issues de l'audit du 10 octobre 2026.
-- S'applique après 0001-0006 (installation neuve ou projet existant).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Privilèges explicites.
-- Les projets Supabase récents n'accordent plus automatiquement les
-- privilèges sur les nouvelles tables aux rôles anon/authenticated :
-- tout est donc accordé explicitement ici (RLS reste la protection).
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array[
    'owners', 'properties', 'property_photos', 'property_documents', 'document_checks',
    'buyers', 'commission_rules', 'mandates', 'inquiries', 'interactions', 'visits',
    'transactions', 'negotiations', 'financial_entries', 'payments', 'expenses',
    'tasks', 'documents', 'profiles'
  ] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

grant select, update on public.agency_settings to authenticated;
grant select on public.activity_logs, public.status_history to authenticated;
revoke all on public.reference_counters from anon, authenticated;
revoke all on public.agency_settings, public.activity_logs, public.status_history from anon;
-- Interdictions maintenues (corrections financières tracées, documents immuables).
revoke delete on public.financial_entries from authenticated;
revoke update, delete on public.payments from authenticated;
revoke update on public.documents from authenticated;

-- Vues : lecture seule. Une vue simple est modifiable automatiquement par
-- PostgreSQL ; sans ce REVOKE, anon pouvait réécrire public_agency_info.
revoke all on public.public_agency_info, public.public_properties, public.public_property_photos,
              public.transaction_commissions from public, anon, authenticated;
grant select on public.public_agency_info, public.public_properties, public.public_property_photos to anon, authenticated;
grant select on public.transaction_commissions to authenticated;

-- Fonctions utilisées dans les politiques RLS (exécutées avec les droits de l'appelant).
grant execute on function public.current_app_role(), public.has_role(public.app_role[]), public.is_staff(),
  public.is_admin(), public.can_sales(), public.can_finance(), public.can_negotiate(),
  public.is_public_status(public.property_status), public.normalize_phone(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Schéma privé (secrets techniques, limitation de débit)
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.app_secret (
  id smallint primary key default 1 check (id = 1),
  secret bytea not null default extensions.gen_random_bytes(32)
);
insert into private.app_secret (id) values (1) on conflict (id) do nothing;

create table if not exists private.inquiry_throttle (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  fingerprint text not null,
  phone_norm text
);
create index if not exists inquiry_throttle_fp_idx on private.inquiry_throttle (fingerprint, created_at);
create index if not exists inquiry_throttle_phone_idx on private.inquiry_throttle (phone_norm, created_at);

-- L'empreinte (hachage de l'IP) ne doit plus être lisible par l'équipe.
alter table public.inquiries drop column if exists client_fingerprint;

-- ---------------------------------------------------------------------
-- 3. Journal d'activité : identifiants non-UUID, nouvelles tables tracées,
--    log_event limité à une liste d'actions.
-- ---------------------------------------------------------------------
create or replace function public.tg_activity_log() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then public.log_redact(to_jsonb(old)) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then public.log_redact(to_jsonb(new)) end;
  v_diff jsonb;
  v_id_txt text;
  v_ref text;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(key, jsonb_build_object('avant', v_old -> key, 'apres', value))
      into v_diff
      from jsonb_each(v_new)
     where v_new -> key is distinct from v_old -> key;
    if v_diff is null then
      return new;
    end if;
  elsif tg_op = 'INSERT' then
    v_diff := v_new;
  else
    v_diff := v_old;
  end if;
  v_id_txt := coalesce(v_new ->> 'id', v_old ->> 'id');
  v_ref := coalesce(v_new ->> 'reference', v_old ->> 'reference', v_new ->> 'email', v_old ->> 'email', v_new ->> 'title', v_old ->> 'title');
  insert into public.activity_logs (actor_id, action, entity_type, entity_id, summary, changes)
  values (auth.uid(), lower(tg_op), tg_table_name,
          case when v_id_txt ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_id_txt::uuid end,
          left(v_ref, 200), v_diff);
  return coalesce(new, old);
end $$;

drop trigger if exists profiles_log on public.profiles;
create trigger profiles_log after insert or update or delete on public.profiles
  for each row execute function public.tg_activity_log();
drop trigger if exists agency_settings_log on public.agency_settings;
create trigger agency_settings_log after update on public.agency_settings
  for each row execute function public.tg_activity_log();
drop trigger if exists tasks_log on public.tasks;
create trigger tasks_log after insert or update or delete on public.tasks
  for each row execute function public.tg_activity_log();
drop trigger if exists interactions_log on public.interactions;
create trigger interactions_log after insert or update or delete on public.interactions
  for each row execute function public.tg_activity_log();
drop trigger if exists inquiries_log on public.inquiries;
create trigger inquiries_log after insert or update or delete on public.inquiries
  for each row execute function public.tg_activity_log();

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
  insert into public.activity_logs (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), p_action, left(p_entity_type, 60), p_entity_id, left(p_summary, 500));
end $$;
revoke execute on function public.log_event(text, text, uuid, text) from public, anon;
grant execute on function public.log_event(text, text, uuid, text) to authenticated;

-- Historique des statuts : visible selon le domaine de chaque rôle.
drop policy if exists status_history_staff_read on public.status_history;
create policy status_history_scoped_read on public.status_history for select to authenticated using (
  (entity_type in ('financial_entries') and public.can_finance())
  or (entity_type in ('buyers', 'inquiries', 'visits') and public.can_sales())
  or (entity_type in ('mandates', 'transactions') and (public.can_sales() or public.can_finance()))
  or (entity_type = 'properties' and public.is_staff())
);

-- ---------------------------------------------------------------------
-- 4. Auteur des enregistrements non falsifiable (created_by, uploaded_by…)
-- ---------------------------------------------------------------------
create or replace function public.tg_lock_author() returns trigger
language plpgsql set search_path = '' as $$
declare v_col text := tg_argv[0];
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new := jsonb_populate_record(new, jsonb_build_object(v_col, auth.uid()));
    end if;
  else
    new := jsonb_populate_record(new, jsonb_build_object(v_col, to_jsonb(old) -> v_col));
  end if;
  return new;
end $$;
revoke execute on function public.tg_lock_author() from public, anon, authenticated;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('owners', 'created_by'), ('properties', 'created_by'), ('buyers', 'created_by'), ('mandates', 'created_by'),
      ('interactions', 'created_by'), ('visits', 'created_by'), ('transactions', 'created_by'),
      ('negotiations', 'created_by'), ('financial_entries', 'created_by'), ('payments', 'created_by'),
      ('expenses', 'created_by'), ('tasks', 'created_by'), ('property_documents', 'uploaded_by'),
      ('documents', 'generated_by')
    ) as x(tbl, col)
  loop
    execute format('drop trigger if exists %I on public.%I', r.tbl || '_lock_author', r.tbl);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.tg_lock_author(%L)',
                   r.tbl || '_lock_author', r.tbl, r.col);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Profils : courriel synchronisé depuis Auth, non modifiable par l'utilisateur.
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
  end if;
  if old.id = auth.uid() and old.role = 'admin'
     and (new.role is distinct from 'admin' or not new.is_active) then
    raise exception 'Un administrateur ne peut pas retirer ses propres droits' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id and email is distinct from new.email;
  return new;
end $$;
revoke execute on function public.handle_user_email_change() from public, anon, authenticated;
drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------
-- 6. Références : format automatique réservé, jamais de blocage du compteur,
--    référence non modifiable (sauf administrateur).
-- ---------------------------------------------------------------------
create or replace function public.tg_set_reference() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_pattern text := '^' || tg_argv[0] || '-[0-9]{4}-[0-9]{5}$';
  v text;
  v_exists boolean;
begin
  if tg_op = 'UPDATE' then
    if new.reference is not distinct from old.reference then
      return new;
    end if;
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'La référence ne peut être modifiée que par un administrateur' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'INSERT' and (new.reference is null or btrim(new.reference) = '') then
    loop
      v := public.next_reference(tg_argv[0]);
      execute format('select exists (select 1 from %I.%I where reference = $1)', tg_table_schema, tg_table_name)
        into v_exists using v;
      exit when not v_exists;
    end loop;
    new.reference := v;
    return new;
  end if;
  new.reference := upper(btrim(new.reference));
  if new.reference ~ v_pattern then
    raise exception 'Le format %-AAAA-NNNNN est réservé aux références automatiques : laissez le champ vide ou choisissez une autre référence', tg_argv[0]
      using errcode = '23514';
  end if;
  if new.reference !~ '^[A-Z0-9][A-Z0-9-]{1,39}$' then
    raise exception 'Référence invalide (2 à 40 caractères : lettres, chiffres et tirets)' using errcode = '23514';
  end if;
  return new;
end $$;

do $$
declare r record;
begin
  for r in
    select * from (values
      ('owners', 'PRO'), ('properties', 'BIEN'), ('buyers', 'ACH'), ('mandates', 'MAN'), ('inquiries', 'DEM'),
      ('visits', 'VIS'), ('transactions', 'TRX'), ('financial_entries', 'REC'), ('expenses', 'DEP'), ('documents', 'DOC')
    ) as x(tbl, prefix)
  loop
    execute format('drop trigger if exists %I on public.%I', r.tbl || '_reference_update', r.tbl);
    execute format('create trigger %I before update of reference on public.%I for each row execute function public.tg_set_reference(%L)',
                   r.tbl || '_reference_update', r.tbl, r.prefix);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 7. Publication : mandat réellement en vigueur, contrôle permanent,
--    dates de publication gérées par la base, biens vendus protégés.
-- ---------------------------------------------------------------------
create or replace function public.agency_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Africa/Abidjan')::date
$$;
grant execute on function public.agency_today() to anon, authenticated;

create or replace function public.publication_blockers_row(p public.properties) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.agency_settings;
  v text[] := '{}';
  v_today date := public.agency_today();
begin
  select * into s from public.agency_settings where id = 1;
  if not found then
    return array['Paramètres de l''agence manquants'];
  end if;
  if p.price_xof is null or p.price_xof <= 0 then
    v := v || 'Le prix doit être renseigné'::text;
  end if;
  if p.description is null or char_length(btrim(p.description)) < 20 then
    v := v || 'La description doit contenir au moins 20 caractères'::text;
  end if;
  if s.publication_requires_verification and p.verification_status <> 'verifie' then
    v := v || 'Le bien doit être vérifié'::text;
  end if;
  if s.publication_requires_active_mandate and not exists (
    select 1 from public.mandates m
     where m.property_id = p.id and m.status = 'actif'
       and m.owner_id is not distinct from p.owner_id
       and m.signed_date <= v_today
       and (m.start_date is null or m.start_date <= v_today)
       and (m.end_date is null or m.end_date >= v_today)
  ) then
    v := v || 'Un mandat actif et en cours de validité est requis'::text;
  end if;
  if s.publication_requires_photo and not exists (
    select 1 from public.property_photos ph where ph.property_id = p.id
  ) then
    v := v || 'Au moins une photo est requise'::text;
  end if;
  return v;
end $$;
revoke execute on function public.publication_blockers_row(public.properties) from public, anon, authenticated;

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
    if new.owner_id is distinct from old.owner_id and old.owner_id is not null and (
      exists (select 1 from public.mandates m where m.property_id = new.id and m.status in ('actif', 'en_attente_signature'))
      or exists (select 1 from public.transactions t where t.property_id = new.id
                  and t.status in ('negociation', 'offre_en_attente', 'offre_acceptee_sous_conditions', 'dossier_en_cours'))
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

-- Mandats : pas de mandat « actif » non signé, signé dans le futur ou échu.
create or replace function public.tg_mandate_validity() returns trigger
language plpgsql set search_path = '' as $$
declare v_today date := public.agency_today();
begin
  if new.status = 'actif' and (tg_op = 'INSERT' or old.status is distinct from 'actif'
       or new.signed_date is distinct from old.signed_date or new.end_date is distinct from old.end_date) then
    if new.signed_date is null or new.signed_date > v_today then
      raise exception 'Un mandat actif doit avoir une date de signature passée ou du jour' using errcode = '23514';
    end if;
    if new.end_date is not null and new.end_date < v_today then
      raise exception 'Ce mandat est échu : choisissez le statut « Expiré »' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.tg_mandate_validity() from public, anon, authenticated;
drop trigger if exists mandates_validity on public.mandates;
create trigger mandates_validity before insert or update on public.mandates
  for each row execute function public.tg_mandate_validity();

-- Vues publiques : seuls les biens publiés ET conformes sont visibles
-- (un mandat qui expire masque l'annonce sans attendre une action humaine).
create or replace view public.public_properties as
  select p.id, p.reference, p.property_type, p.title, p.description, p.region, p.city,
         p.district, p.location_description, p.price_xof, p.negotiable, p.area, p.area_unit,
         p.bedrooms, p.bathrooms, p.features, p.commercial_status, p.is_featured, p.is_demo,
         p.published_at,
         (select ph.storage_path from public.property_photos ph
           where ph.property_id = p.id order by ph.is_primary desc, ph.position, ph.created_at limit 1) as primary_photo_path,
         lower(extensions.unaccent(concat_ws(' ', p.title, p.reference, p.city, p.district, p.region))) as search_text,
         lower(extensions.unaccent(coalesce(p.district, ''))) as district_search
    from public.properties p
   where public.is_public_status(p.commercial_status)
     -- Mêmes règles que publication_blockers_row(), écrites ici pour ne pas exposer
     -- de fonction privilégiée au rôle anon (le droit EXECUTE est vérifié pour l'appelant).
     and exists (
       select 1 from public.agency_settings s
        where s.id = 1
          and coalesce(p.price_xof, 0) > 0
          and char_length(btrim(coalesce(p.description, ''))) >= 20
          and (not s.publication_requires_verification or p.verification_status = 'verifie')
          and (not s.publication_requires_photo or exists (select 1 from public.property_photos ph2 where ph2.property_id = p.id))
          and (not s.publication_requires_active_mandate or exists (
                select 1 from public.mandates m
                 where m.property_id = p.id and m.status = 'actif'
                   and m.owner_id is not distinct from p.owner_id
                   and m.signed_date <= public.agency_today()
                   and (m.start_date is null or m.start_date <= public.agency_today())
                   and (m.end_date is null or m.end_date >= public.agency_today()))));

create or replace view public.public_property_photos as
  select ph.id, ph.property_id, ph.storage_path, ph.caption, ph.position, ph.is_primary
    from public.property_photos ph
   where ph.property_id in (select pp.id from public.public_properties pp);

revoke all on public.public_properties, public.public_property_photos from public, anon, authenticated;
grant select on public.public_properties, public.public_property_photos to anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Transactions : dossiers clôturés figés, pas de dossier sur un bien vendu,
--    effets cohérents à la conclusion, à l'abandon et à la réouverture.
-- ---------------------------------------------------------------------
create or replace function public.tg_transaction_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_status public.property_status;
begin
  select owner_id, commercial_status into v_owner, v_status from public.properties where id = new.property_id;
  if v_owner is not null and v_owner <> new.owner_id then
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

create or replace function public.tg_transaction_effects() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_open public.transaction_status[] := array['negociation', 'offre_en_attente', 'offre_acceptee_sous_conditions', 'dossier_en_cours']::public.transaction_status[];
  v_amount numeric;
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
    -- Les autres dossiers ouverts sur ce bien sont clos (un bien ne se vend qu'une fois).
    update public.transactions
       set status = 'annulee', abandon_reason = 'Bien vendu via ' || new.reference
     where property_id = new.property_id and id <> new.id and status = any (v_open);
    -- Commission : une écriture prévue devient exigible, sinon création automatique.
    update public.financial_entries
       set status = 'exigible', entry_date = coalesce(new.concluded_date, entry_date)
     where transaction_id = new.id and entry_type = 'commission' and status = 'prevu' and amount_expected > 0;
    if not exists (select 1 from public.financial_entries f
                    where f.transaction_id = new.id and f.entry_type = 'commission' and f.status <> 'annule') then
      select coalesce(new.commission_agreed, tc.commission_estimated, 0) into v_amount
        from public.transaction_commissions tc where tc.transaction_id = new.id;
      v_amount := coalesce(v_amount, new.commission_agreed, 0);
      insert into public.financial_entries (entry_date, entry_type, transaction_id, amount_expected, status, notes)
      values (coalesce(new.concluded_date, v_today), 'commission', new.id, v_amount,
              (case when v_amount > 0 then 'exigible' else 'prevu' end)::public.revenue_status,
              case when new.commission_agreed is null
                   then 'Montant estimé selon la règle de commission, à confirmer. ' else '' end
              || 'Créée automatiquement à la conclusion de ' || new.reference);
    end if;
  elsif new.status = any (v_open) then
    update public.properties set commercial_status = 'sous_negociation'
     where id = new.property_id and commercial_status = 'publie';
  elsif new.status in ('annulee', 'abandonnee') then
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

-- Commission convenue modifiée après la vente (administrateur) : l'écriture suit.
create or replace function public.tg_transaction_commission_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'vente_conclue' and new.commission_agreed is not null
     and new.commission_agreed is distinct from old.commission_agreed then
    update public.financial_entries
       set amount_expected = new.commission_agreed,
           status = (case when amount_received = 0 then (case when new.commission_agreed > 0 then 'exigible' else 'prevu' end)
                          when amount_received < new.commission_agreed then 'partiel'
                          else 'encaisse' end)::public.revenue_status
     where transaction_id = new.id and entry_type = 'commission'
       and status in ('prevu', 'exigible', 'partiel', 'encaisse')
       and amount_received <= new.commission_agreed;
  end if;
  return new;
end $$;
revoke execute on function public.tg_transaction_commission_sync() from public, anon, authenticated;
drop trigger if exists transactions_commission_sync on public.transactions;
create trigger transactions_commission_sync after update of commission_agreed on public.transactions
  for each row execute function public.tg_transaction_commission_sync();

-- ---------------------------------------------------------------------
-- 9. Recettes : pas d'annulation avec encaissements, statut recalculé
--    quand le montant attendu change.
-- ---------------------------------------------------------------------
create or replace function public.tg_financial_entry_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() = 1 then
    if new.amount_received is distinct from old.amount_received then
      raise exception 'Le montant encaissé est calculé à partir des encaissements' using errcode = '23514';
    end if;
    if new.status is distinct from old.status
       and (new.status in ('partiel', 'encaisse') or old.status in ('partiel', 'encaisse') and new.status <> 'annule') then
      raise exception 'Les statuts « partiel » et « encaissé » sont calculés à partir des encaissements' using errcode = '23514';
    end if;
    if new.status = 'annule' and old.status <> 'annule' and old.amount_received <> 0 then
      raise exception 'Recette déjà encaissée : saisissez d''abord une correction ramenant l''encaissé à 0' using errcode = '23514';
    end if;
  end if;
  if new.amount_expected < new.amount_received then
    raise exception 'Le montant attendu ne peut pas être inférieur au montant déjà encaissé' using errcode = '23514';
  end if;
  if new.amount_expected is distinct from old.amount_expected and new.status in ('exigible', 'partiel', 'encaisse') then
    new.status := (case when new.amount_received = 0 then 'exigible'
                        when new.amount_received < new.amount_expected then 'partiel'
                        else 'encaisse' end)::public.revenue_status;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 10. Demandes publiques : limitation de débit fiable, empreinte HMAC privée,
--     biens fictifs non rattachés ; consentement tracé pour les saisies internes.
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

  insert into public.inquiries (full_name, phone, email, property_id, property_reference_input,
                                message, contact_preference, consent, consent_text, source)
  values (v_name, v_phone, v_email, v_property, v_ref, v_msg, v_pref, true,
          (select inquiry_consent_text from public.agency_settings where id = 1), 'site_web')
  returning reference into v_reference;

  return jsonb_build_object('ok', true, 'reference', v_reference);
end $$;
revoke execute on function public.submit_inquiry(text, text, text, text, text, text, boolean, text) from public;
grant execute on function public.submit_inquiry(text, text, text, text, text, text, boolean, text) to anon, authenticated;

-- Demande saisie par l'équipe : l'accord déclaré est horodaté et attribué.
create or replace function public.tg_inquiry_consent() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and new.consent and (tg_op = 'INSERT' or not old.consent) then
    new.consent_text := 'Accord déclaré par ' ||
      coalesce((select nullif(full_name, '') from public.profiles where id = auth.uid()),
               (select email from public.profiles where id = auth.uid()), 'un membre de l''équipe') ||
      ' le ' || to_char(now() at time zone 'Africa/Abidjan', 'DD/MM/YYYY HH24:MI') || ' (saisie interne)';
  elsif not new.consent then
    new.consent_text := null;
  end if;
  return new;
end $$;
revoke execute on function public.tg_inquiry_consent() from public, anon, authenticated;
drop trigger if exists inquiries_consent on public.inquiries;
create trigger inquiries_consent before insert or update of consent on public.inquiries
  for each row execute function public.tg_inquiry_consent();

-- Prospects : date de consentement tenue à jour automatiquement.
create or replace function public.tg_buyer_consent_date() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not (new.consent_contact or new.consent_marketing) then
    new.consent_date := null;
  elsif new.consent_date is null
        or (tg_op = 'UPDATE' and not (old.consent_contact or old.consent_marketing)) then
    new.consent_date := coalesce(case when tg_op = 'INSERT' then new.consent_date end, now());
  end if;
  return new;
end $$;
revoke execute on function public.tg_buyer_consent_date() from public, anon, authenticated;
drop trigger if exists buyers_consent_date on public.buyers;
create trigger buyers_consent_date before insert or update of consent_contact, consent_marketing, consent_date on public.buyers
  for each row execute function public.tg_buyer_consent_date();

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
    insert into public.buyers (last_name, first_names, phone, email, source, contact_preference,
                               consent_contact, consent_date, status, notes)
    values (v_parts[1], nullif(array_to_string(v_parts[2:], ' '), ''), i.phone, i.email,
            case i.source when 'site_web' then 'Site web' when 'whatsapp' then 'WhatsApp'
                          when 'telephone' then 'Téléphone' else 'Autre' end,
            i.contact_preference, i.consent, case when i.consent then i.created_at end, 'a_contacter',
            'Créé depuis la demande ' || i.reference)
    returning id into v_buyer;
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
-- 11. Données personnelles : anonymisation (droit à l'effacement) par l'administrateur.
-- ---------------------------------------------------------------------
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
  update public.tasks set description = null, result = null where buyer_id = p_buyer_id;
  insert into public.activity_logs (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), 'anonymisation', 'buyers', p_buyer_id, v_ref);
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
  update public.document_checks set comment = null where owner_id = p_owner_id;
  update public.tasks set description = null, result = null where owner_id = p_owner_id;
  insert into public.activity_logs (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), 'anonymisation', 'owners', p_owner_id, v_ref);
end $$;

revoke execute on function public.anonymize_buyer(uuid), public.anonymize_owner(uuid) from public, anon;
grant execute on function public.anonymize_buyer(uuid), public.anonymize_owner(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 12. Maintenance quotidienne (appelée à l'ouverture du tableau de bord) :
--     mandats échus → « Expiré », annonces non conformes → dépubliées.
-- ---------------------------------------------------------------------
create or replace function public.run_maintenance() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_mandates int;
  v_props int;
begin
  if not public.is_staff() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  update public.mandates set status = 'expire'
   where status = 'actif' and end_date is not null and end_date < public.agency_today();
  get diagnostics v_mandates = row_count;
  update public.properties as p set commercial_status = 'disponible'
   where p.commercial_status = 'publie' and cardinality(public.publication_blockers_row(p)) > 0;
  get diagnostics v_props = row_count;
  return jsonb_build_object('mandates_expired', v_mandates, 'properties_unpublished', v_props);
end $$;
revoke execute on function public.run_maintenance() from public, anon;
grant execute on function public.run_maintenance() to authenticated;

-- ---------------------------------------------------------------------
-- 13. Rapports et indicateurs
-- ---------------------------------------------------------------------
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
            where lower(extensions.unaccent(p.city)) = lower(extensions.unaccent(z))
               or lower(extensions.unaccent(coalesce(p.district, ''))) = lower(extensions.unaccent(z))))
     -- Superficie minimale exprimée en m² ; les biens « au lot » ne sont pas écartés.
     and (b.area_min is null or p.area is null or p.area_unit = 'lot'
          or (case p.area_unit when 'ha' then p.area * 10000 else p.area end) >= b.area_min)
     and (b.bedrooms_min is null or coalesce(p.bedrooms, 0) >= b.bedrooms_min)
   order by p.published_at desc nulls last
   limit 50
$$;
revoke execute on function public.property_matches(uuid) from public, anon;
grant execute on function public.property_matches(uuid) to authenticated;

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
    -- Attendu : recettes datées dans la période ; encaissé : paiements reçus dans la période (même base que le total).
    'revenues_by_type', (select coalesce(jsonb_agg(x order by x.entry_type), '[]'::jsonb) from (
        select t.entry_type,
               coalesce(e.expected, 0) as expected,
               coalesce(r.received, 0) as received,
               coalesce(e.balance, 0) as balance
          from (select unnest(enum_range(null::public.revenue_type)) as entry_type) t
          left join (select fe.entry_type, sum(fe.amount_expected) as expected, sum(fe.balance) as balance
                       from public.financial_entries fe
                      where fe.status <> 'annule' and fe.entry_date between p_from and p_to
                      group by fe.entry_type) e on e.entry_type = t.entry_type
          left join (select fe.entry_type, sum(pa.amount) as received
                       from public.payments pa join public.financial_entries fe on fe.id = pa.financial_entry_id
                      where pa.paid_on between p_from and p_to
                      group by fe.entry_type) r on r.entry_type = t.entry_type
         where e.entry_type is not null or r.entry_type is not null) x),
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
grant execute on function public.finance_report(date, date) to authenticated;

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
      -- Un bien ne se vend qu'une fois : on retient l'estimation maximale par bien.
      'commissions_estimated', (select coalesce(sum(m), 0) from (
                                  select max(commission_estimated) as m from public.transaction_commissions
                                   where status = any (v_open) group by property_id) x),
      'commissions_agreed_open', (select coalesce(sum(commission_agreed), 0) from public.transactions
                                   where status = any (v_open)),
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

-- Fonctions appelées par l'interface de l'équipe.
grant execute on function public.publication_blockers(uuid), public.find_duplicate_contacts(text, text, uuid),
  public.estimate_commission(numeric, public.commission_calc, numeric, numeric, numeric) to authenticated;

-- Fonctions de déclencheurs : jamais appelables via l'API.
revoke execute on function public.tg_activity_log(), public.tg_set_reference(), public.tg_property_publication(),
  public.tg_transaction_rules(), public.tg_transaction_effects(), public.tg_financial_entry_guard(),
  public.tg_profiles_guard() from public, anon, authenticated;
