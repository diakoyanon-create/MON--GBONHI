-- INSTALLATION COMPLÈTE (générée par scripts/build-install-sql.mjs — ne pas modifier à la main)
-- À exécuter UNE SEULE FOIS sur un projet Supabase vierge : SQL Editor → New query → coller → Run.
-- Contient les 7 migrations dans l'ordre. Ne contient AUCUNE donnée de démonstration.

-- ===== 20261009000100_fondations.sql =====
-- =====================================================================
-- 0001 — Fondations : extensions, types, profils, rôles, paramètres,
--        journal d'activité, historique des statuts, références.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------
-- Types énumérés
-- ---------------------------------------------------------------------
create type public.app_role as enum ('admin', 'agent', 'assistant', 'comptable');

create type public.contact_preference as enum ('telephone', 'whatsapp', 'email', 'sms');

create type public.verification_status as enum ('a_verifier', 'en_cours', 'verifie', 'non_conforme');

-- ---------------------------------------------------------------------
-- Fonction utilitaire : updated_at
-- ---------------------------------------------------------------------
create or replace function public.tg_set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Profils utilisateurs
-- Un compte créé dans Supabase Auth n'a AUCUN accès tant qu'un
-- administrateur ne lui a pas attribué un rôle et ne l'a pas activé.
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  email text,
  phone text check (phone is null or char_length(phone) <= 30),
  role public.app_role,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, role, is_active)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''), null, false)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Helpers de permissions (SECURITY DEFINER pour éviter la récursion RLS)
-- ---------------------------------------------------------------------
create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.is_active and p.role is not null
$$;

create or replace function public.has_role(roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_app_role() = any (roles), false)
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.current_app_role() is not null
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role(array['admin']::public.app_role[])
$$;

-- Accès « commercial » : biens, contacts, visites…
create or replace function public.can_sales() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role(array['admin', 'agent', 'assistant']::public.app_role[])
$$;

-- Accès « finances » : recettes, dépenses, commissions.
create or replace function public.can_finance() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role(array['admin', 'comptable']::public.app_role[])
$$;

-- Accès « négociation » : offres, transactions (l'assistant ne fait que lire).
create or replace function public.can_negotiate() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role(array['admin', 'agent']::public.app_role[])
$$;

alter table public.profiles enable row level security;

create policy profiles_select_self_or_staff on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_staff());

-- Un utilisateur peut modifier son nom/téléphone, jamais son rôle ni son statut.
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_admin_all on public.profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.tg_profiles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Seuls l'administrateur et les sessions serveur (sans JWT) changent rôle / activation.
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'Seul un administrateur peut modifier le rôle ou l''activation d''un compte'
      using errcode = '42501';
  end if;
  -- Un administrateur ne peut pas se retirer lui-même ses droits (évite le verrouillage).
  if old.id = auth.uid() and old.role = 'admin'
     and (new.role is distinct from 'admin' or not new.is_active) then
    raise exception 'Un administrateur ne peut pas retirer ses propres droits' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();

revoke all on public.profiles from anon;

-- Création du premier administrateur : à exécuter dans l'éditeur SQL
-- Supabase (rôle postgres) APRÈS avoir invité l'utilisateur. Aucun mot de passe en dur.
create or replace function public.promote_to_admin(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(p_email);
  if v_id is null then
    raise exception 'Aucun utilisateur avec le courriel %', p_email;
  end if;
  insert into public.profiles (id, email, role, is_active)
  values (v_id, p_email, 'admin', true)
  on conflict (id) do update set role = 'admin', is_active = true;
end $$;
revoke execute on function public.promote_to_admin(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Paramètres de l'agence (une seule ligne)
-- ---------------------------------------------------------------------
create table public.agency_settings (
  id smallint primary key default 1 check (id = 1),
  agency_name text not null default 'Mon Agence Immobilière' check (char_length(agency_name) between 1 and 120),
  tagline text,
  logo_url text,
  phone text,
  whatsapp_number text check (whatsapp_number is null or whatsapp_number ~ '^[0-9]{8,15}$'),
  whatsapp_message_template text not null default 'Bonjour, je suis intéressé(e) par le bien référence {reference}.',
  email text,
  address text,
  about text,
  zones_served text[] not null default '{}',
  currency text not null default 'XOF' check (currency = 'XOF'),
  timezone text not null default 'Africa/Abidjan',
  property_categories text[] not null default array['terrain', 'maison', 'appartement', 'immeuble', 'local_commercial', 'autre'],
  contact_sources text[] not null default array['Site web', 'WhatsApp', 'Téléphone', 'Recommandation', 'Réseaux sociaux', 'Panneau', 'Autre'],
  expense_categories text[] not null default array['Publicité', 'Transport', 'Communication', 'Frais administratifs', 'Fournitures', 'Loyer bureau', 'Autre'],
  task_categories text[] not null default array['Appel', 'Relance', 'Visite', 'Administratif', 'Juridique', 'Autre'],
  document_footer text,
  privacy_policy text,
  legal_notice text,
  data_retention_months integer not null default 36 check (data_retention_months between 1 and 240),
  publication_requires_verification boolean not null default true,
  publication_requires_active_mandate boolean not null default true,
  publication_requires_photo boolean not null default true,
  inquiry_consent_text text not null default 'J''accepte que l''agence utilise ces informations pour répondre à ma demande.',
  updated_at timestamptz not null default now()
);
insert into public.agency_settings (id) values (1);
create trigger agency_settings_updated_at before update on public.agency_settings
  for each row execute function public.tg_set_updated_at();

alter table public.agency_settings enable row level security;
create policy agency_settings_staff_read on public.agency_settings
  for select to authenticated using (public.is_staff());
create policy agency_settings_admin_update on public.agency_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.agency_settings from anon;

-- Vue publique : uniquement les informations de vitrine.
create view public.public_agency_info as
  select agency_name, tagline, logo_url, phone, whatsapp_number, whatsapp_message_template,
         email, address, about, zones_served, privacy_policy, legal_notice, inquiry_consent_text
  from public.agency_settings where id = 1;
grant select on public.public_agency_info to anon, authenticated;

-- ---------------------------------------------------------------------
-- Journal d'activité (append-only)
-- ---------------------------------------------------------------------
create table public.activity_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text,
  changes jsonb
);
create index activity_logs_entity_idx on public.activity_logs (entity_type, entity_id);
create index activity_logs_occurred_idx on public.activity_logs (occurred_at desc);

alter table public.activity_logs enable row level security;
create policy activity_logs_admin_read on public.activity_logs
  for select to authenticated using (public.is_admin());
-- Aucune politique insert/update/delete : écriture uniquement via fonctions SECURITY DEFINER.
revoke all on public.activity_logs from anon, authenticated;
grant select on public.activity_logs to authenticated;

-- Colonnes jamais journalisées.
create or replace function public.log_redact(j jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(j, '{}'::jsonb) - array['password', 'encrypted_password', 'token', 'api_key', 'secret', 'updated_at']
$$;

create or replace function public.tg_activity_log() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then public.log_redact(to_jsonb(old)) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then public.log_redact(to_jsonb(new)) end;
  v_diff jsonb;
  v_id uuid;
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
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
  v_ref := coalesce(v_new ->> 'reference', v_old ->> 'reference');
  insert into public.activity_logs (actor_id, action, entity_type, entity_id, summary, changes)
  values (auth.uid(), lower(tg_op), tg_table_name, v_id, v_ref, v_diff);
  return coalesce(new, old);
end $$;

-- Journalisation explicite (exports sensibles, publications…)
create or replace function public.log_event(p_action text, p_entity_type text, p_entity_id uuid, p_summary text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  insert into public.activity_logs (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), left(p_action, 60), left(p_entity_type, 60), p_entity_id, left(p_summary, 500));
end $$;
revoke execute on function public.log_event(text, text, uuid, text) from public, anon;

-- ---------------------------------------------------------------------
-- Historique des statuts (biens, mandats, prospects, transactions…)
-- ---------------------------------------------------------------------
create table public.status_history (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id uuid not null,
  old_status text,
  new_status text not null,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now()
);
create index status_history_entity_idx on public.status_history (entity_type, entity_id, changed_at);
alter table public.status_history enable row level security;
create policy status_history_staff_read on public.status_history
  for select to authenticated using (public.is_staff());
revoke all on public.status_history from anon, authenticated;
grant select on public.status_history to authenticated;

-- TG_ARGV[0] = nom de la colonne statut
create or replace function public.tg_status_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_col text := tg_argv[0];
  v_old text;
  v_new text;
begin
  v_new := to_jsonb(new) ->> v_col;
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old) ->> v_col;
    if v_old is not distinct from v_new then
      return new;
    end if;
  end if;
  insert into public.status_history (entity_type, entity_id, old_status, new_status, changed_by)
  values (tg_table_name, new.id, v_old, v_new, auth.uid());
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Génération des références commerciales (PREFIXE-AAAA-00001)
-- ---------------------------------------------------------------------
create table public.reference_counters (
  prefix text not null,
  year integer not null,
  last_value integer not null default 0,
  primary key (prefix, year)
);
alter table public.reference_counters enable row level security;
revoke all on public.reference_counters from anon, authenticated;

create or replace function public.next_reference(p_prefix text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_year integer := extract(year from (now() at time zone 'Africa/Abidjan'))::integer;
  v_val integer;
begin
  insert into public.reference_counters (prefix, year, last_value)
  values (p_prefix, v_year, 1)
  on conflict (prefix, year) do update set last_value = public.reference_counters.last_value + 1
  returning last_value into v_val;
  return p_prefix || '-' || v_year || '-' || lpad(v_val::text, 5, '0');
end $$;
revoke execute on function public.next_reference(text) from public, anon, authenticated;

-- TG_ARGV[0] = préfixe
create or replace function public.tg_set_reference() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.reference is null or btrim(new.reference) = '' then
    new.reference := public.next_reference(tg_argv[0]);
  else
    new.reference := upper(btrim(new.reference));
  end if;
  return new;
end $$;

-- Les fonctions de trigger ne doivent pas être appelables via l'API.
revoke execute on function public.tg_set_updated_at() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.tg_profiles_guard() from public, anon, authenticated;
revoke execute on function public.tg_activity_log() from public, anon, authenticated;
revoke execute on function public.tg_status_history() from public, anon, authenticated;
revoke execute on function public.tg_set_reference() from public, anon, authenticated;


-- ===== 20261009000200_portefeuille.sql =====
-- =====================================================================
-- 0002 — Portefeuille : propriétaires, biens, photos, documents,
--        contrôles documentaires, acheteurs, mandats.
-- =====================================================================

create type public.property_type as enum ('terrain', 'maison', 'appartement', 'immeuble', 'local_commercial', 'autre');

create type public.property_status as enum (
  'brouillon', 'a_verifier', 'disponible', 'publie', 'sous_negociation',
  'reserve', 'vendu', 'retire', 'archive'
);

create type public.area_unit as enum ('m2', 'ha', 'lot');

create type public.buyer_status as enum (
  'nouveau', 'a_contacter', 'contact_etabli', 'besoin_qualifie', 'visite_programmee',
  'en_negociation', 'converti', 'sans_suite', 'archive'
);

create type public.mandate_type as enum ('simple', 'exclusif', 'semi_exclusif', 'autre');

create type public.mandate_status as enum ('brouillon', 'en_attente_signature', 'actif', 'expire', 'resilie', 'cloture');

create type public.commission_calc as enum ('fixe', 'pourcentage', 'autre');

-- Normalisation des numéros (chiffres uniquement, 10 derniers chiffres pour la CI)
create or replace function public.normalize_phone(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), 10), '')
$$;

-- ---------------------------------------------------------------------
-- Propriétaires / vendeurs
-- ---------------------------------------------------------------------
create table public.owners (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  last_name text not null check (char_length(btrim(last_name)) between 1 and 80),
  first_names text check (first_names is null or char_length(first_names) <= 120),
  phone_primary text not null check (char_length(phone_primary) between 6 and 30),
  phone_secondary text check (phone_secondary is null or char_length(phone_secondary) <= 30),
  locality text,
  address text,
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_preference public.contact_preference not null default 'telephone',
  first_contact_date date,
  source text,
  notes text,
  verification_status public.verification_status not null default 'a_verifier',
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index owners_phone_idx on public.owners (public.normalize_phone(phone_primary));
create index owners_name_idx on public.owners (lower(last_name));
create trigger owners_reference before insert on public.owners
  for each row execute function public.tg_set_reference('PRO');
create trigger owners_updated_at before update on public.owners
  for each row execute function public.tg_set_updated_at();
create trigger owners_log after insert or update or delete on public.owners
  for each row execute function public.tg_activity_log();

-- ---------------------------------------------------------------------
-- Biens immobiliers
-- ---------------------------------------------------------------------
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  property_type public.property_type not null,
  title text not null check (char_length(btrim(title)) between 3 and 160),
  description text check (description is null or char_length(description) <= 8000),
  region text,
  city text not null check (char_length(btrim(city)) >= 2),
  district text,
  location_description text,
  latitude numeric(9, 6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude is null or longitude between -180 and 180),
  price_xof numeric(15, 0) check (price_xof is null or price_xof >= 0),
  negotiable boolean not null default true,
  area numeric(12, 2) check (area is null or area > 0),
  area_unit public.area_unit not null default 'm2',
  bedrooms smallint check (bedrooms is null or bedrooms between 0 and 100),
  bathrooms smallint check (bathrooms is null or bathrooms between 0 and 100),
  features text[] not null default '{}',
  owner_id uuid references public.owners (id) on delete restrict,
  listing_origin text,
  assigned_to uuid references public.profiles (id) on delete set null,
  verification_status public.verification_status not null default 'a_verifier',
  commercial_status public.property_status not null default 'brouillon',
  unavailability_reason text,
  is_featured boolean not null default false,
  is_demo boolean not null default false,
  published_at timestamptz,
  unpublished_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index properties_status_idx on public.properties (commercial_status);
create index properties_type_idx on public.properties (property_type);
create index properties_city_idx on public.properties (lower(city), lower(district));
create index properties_price_idx on public.properties (price_xof);
create index properties_owner_idx on public.properties (owner_id);
create index properties_title_trgm on public.properties using gin (title extensions.gin_trgm_ops);

create trigger properties_reference before insert on public.properties
  for each row execute function public.tg_set_reference('BIEN');
create trigger properties_updated_at before update on public.properties
  for each row execute function public.tg_set_updated_at();
create trigger properties_log after insert or update or delete on public.properties
  for each row execute function public.tg_activity_log();
create trigger properties_status_history after insert or update of commercial_status on public.properties
  for each row execute function public.tg_status_history('commercial_status');

-- Statuts visibles sur le site public.
create or replace function public.is_public_status(s public.property_status) returns boolean
language sql immutable set search_path = '' as $$
  select s in ('publie', 'sous_negociation', 'reserve')
$$;

-- ---------------------------------------------------------------------
-- Photos (stockage public) et documents (stockage privé)
-- ---------------------------------------------------------------------
create table public.property_photos (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  storage_path text not null unique,
  caption text check (caption is null or char_length(caption) <= 200),
  position integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index property_photos_property_idx on public.property_photos (property_id, position);
create unique index property_photos_one_primary on public.property_photos (property_id) where is_primary;

create table public.property_documents (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties (id) on delete restrict,
  owner_id uuid references public.owners (id) on delete restrict,
  title text not null check (char_length(title) between 1 and 200),
  doc_type text not null,
  storage_path text not null unique,
  mime_type text,
  file_size bigint check (file_size is null or file_size <= 15728640),
  uploaded_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (property_id is not null or owner_id is not null)
);
create trigger property_documents_log after insert or delete on public.property_documents
  for each row execute function public.tg_activity_log();

-- Fiche de contrôle des documents (titre foncier, ACD, pièces d'identité…)
create table public.document_checks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id) on delete restrict,
  property_id uuid references public.properties (id) on delete restrict,
  doc_type text not null check (char_length(doc_type) between 2 and 80),
  doc_reference text,
  received_date date,
  verification_status public.verification_status not null default 'a_verifier',
  verified_at date,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (verification_status <> 'verifie' or verified_at is not null)
);
create trigger document_checks_updated_at before update on public.document_checks
  for each row execute function public.tg_set_updated_at();
create trigger document_checks_log after insert or update or delete on public.document_checks
  for each row execute function public.tg_activity_log();

-- ---------------------------------------------------------------------
-- Acheteurs et prospects
-- ---------------------------------------------------------------------
create table public.buyers (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  last_name text not null check (char_length(btrim(last_name)) between 1 and 80),
  first_names text,
  phone text not null check (char_length(phone) between 6 and 30),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  budget_min numeric(15, 0) check (budget_min is null or budget_min >= 0),
  budget_max numeric(15, 0) check (budget_max is null or budget_max >= 0),
  zones text[] not null default '{}',
  property_types public.property_type[] not null default '{}',
  area_min numeric(12, 2) check (area_min is null or area_min > 0),
  bedrooms_min smallint check (bedrooms_min is null or bedrooms_min >= 0),
  project_timeline text,
  source text,
  contact_preference public.contact_preference not null default 'telephone',
  consent_contact boolean not null default false,
  consent_marketing boolean not null default false,
  consent_date timestamptz,
  last_contact_at timestamptz,
  next_follow_up_at timestamptz,
  status public.buyer_status not null default 'nouveau',
  notes text,
  assigned_to uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (budget_min is null or budget_max is null or budget_min <= budget_max)
);
create index buyers_phone_idx on public.buyers (public.normalize_phone(phone));
create index buyers_email_idx on public.buyers (lower(email));
create index buyers_status_idx on public.buyers (status);
create index buyers_follow_up_idx on public.buyers (next_follow_up_at);
create trigger buyers_reference before insert on public.buyers
  for each row execute function public.tg_set_reference('ACH');
create trigger buyers_updated_at before update on public.buyers
  for each row execute function public.tg_set_updated_at();
create trigger buyers_log after insert or update or delete on public.buyers
  for each row execute function public.tg_activity_log();
create trigger buyers_status_history after insert or update of status on public.buyers
  for each row execute function public.tg_status_history('status');

-- ---------------------------------------------------------------------
-- Règles de commission (configurables, jamais présentées comme légales)
-- ---------------------------------------------------------------------
create table public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 120),
  calc_type public.commission_calc not null,
  rate_percent numeric(6, 3) check (rate_percent is null or (rate_percent >= 0 and rate_percent <= 100)),
  fixed_amount numeric(15, 0) check (fixed_amount is null or fixed_amount >= 0),
  min_amount numeric(15, 0) check (min_amount is null or min_amount >= 0),
  payer text not null default 'vendeur' check (payer in ('vendeur', 'acheteur', 'partage')),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (calc_type <> 'pourcentage' or rate_percent is not null),
  check (calc_type <> 'fixe' or fixed_amount is not null)
);
create trigger commission_rules_updated_at before update on public.commission_rules
  for each row execute function public.tg_set_updated_at();
create trigger commission_rules_log after insert or update or delete on public.commission_rules
  for each row execute function public.tg_activity_log();

-- ---------------------------------------------------------------------
-- Mandats
-- ---------------------------------------------------------------------
create table public.mandates (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  owner_id uuid not null references public.owners (id) on delete restrict,
  property_id uuid not null references public.properties (id) on delete restrict,
  mandate_type public.mandate_type not null default 'simple',
  signed_date date,
  start_date date,
  end_date date,
  conditions text,
  commission_rule_id uuid references public.commission_rules (id) on delete restrict,
  commission_calc public.commission_calc,
  commission_rate_percent numeric(6, 3) check (commission_rate_percent is null or commission_rate_percent between 0 and 100),
  commission_fixed_amount numeric(15, 0) check (commission_fixed_amount is null or commission_fixed_amount >= 0),
  commission_notes text,
  status public.mandate_status not null default 'brouillon',
  signed_document_path text,
  reminder_date date,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date),
  check (status not in ('actif', 'expire', 'resilie', 'cloture') or signed_date is not null)
);
create index mandates_property_idx on public.mandates (property_id);
create index mandates_owner_idx on public.mandates (owner_id);
create index mandates_status_idx on public.mandates (status, end_date);
-- Un seul mandat actif par bien.
create unique index mandates_one_active on public.mandates (property_id) where status = 'actif';

create trigger mandates_reference before insert on public.mandates
  for each row execute function public.tg_set_reference('MAN');
create trigger mandates_updated_at before update on public.mandates
  for each row execute function public.tg_set_updated_at();
create trigger mandates_log after insert or update or delete on public.mandates
  for each row execute function public.tg_activity_log();
create trigger mandates_status_history after insert or update of status on public.mandates
  for each row execute function public.tg_status_history('status');

-- Le propriétaire du mandat doit être celui du bien.
create or replace function public.tg_mandate_owner_check() returns trigger
language plpgsql set search_path = '' as $$
declare v_owner uuid;
begin
  select owner_id into v_owner from public.properties where id = new.property_id;
  if v_owner is not null and v_owner <> new.owner_id then
    raise exception 'Le propriétaire du mandat ne correspond pas au propriétaire du bien'
      using errcode = '23514';
  end if;
  return new;
end $$;
create trigger mandates_owner_check before insert or update of owner_id, property_id on public.mandates
  for each row execute function public.tg_mandate_owner_check();

-- ---------------------------------------------------------------------
-- Règles de publication (appliquées en base : impossible de contourner via l'API)
-- ---------------------------------------------------------------------
create or replace function public.publication_blockers_row(p public.properties) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.agency_settings;
  v text[] := '{}';
begin
  select * into s from public.agency_settings where id = 1;
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
    select 1 from public.mandates m where m.property_id = p.id and m.status = 'actif'
  ) then
    v := v || 'Un mandat actif est requis'::text;
  end if;
  if s.publication_requires_photo and not exists (
    select 1 from public.property_photos ph where ph.property_id = p.id
  ) then
    v := v || 'Au moins une photo est requise'::text;
  end if;
  return v;
end $$;

-- Pour l'interface : liste des conditions manquantes avant publication.
create or replace function public.publication_blockers(p_property_id uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare p public.properties;
begin
  if not public.is_staff() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select * into p from public.properties where id = p_property_id;
  if not found then
    return array['Bien introuvable'];
  end if;
  return public.publication_blockers_row(p);
end $$;

create or replace function public.tg_property_publication() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_blockers text[];
begin
  if public.is_public_status(new.commercial_status)
     and (tg_op = 'INSERT' or not public.is_public_status(old.commercial_status)) then
    if tg_op = 'INSERT' then
      raise exception 'Un bien doit être créé puis publié après validation' using errcode = '23514';
    end if;
    if old.commercial_status in ('vendu', 'archive') then
      raise exception 'Un bien vendu ou archivé ne peut pas être publié' using errcode = '23514';
    end if;
    v_blockers := public.publication_blockers_row(new);
    if array_length(v_blockers, 1) > 0 then
      raise exception 'Publication impossible : %', array_to_string(v_blockers, ' ; ') using errcode = '23514';
    end if;
    new.published_at := coalesce(new.published_at, now());
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
create trigger properties_publication before insert or update on public.properties
  for each row execute function public.tg_property_publication();

-- Photo principale : une seule par bien ; à défaut, la première de la galerie.
create or replace function public.tg_photo_primary() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_primary then
    update public.property_photos set is_primary = false
     where property_id = new.property_id and id <> new.id and is_primary;
  end if;
  return new;
end $$;
create trigger property_photos_primary before insert or update of is_primary on public.property_photos
  for each row execute function public.tg_photo_primary();

create or replace function public.tg_photo_ensure_primary() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_property uuid := coalesce(new.property_id, old.property_id);
begin
  if not exists (select 1 from public.property_photos where property_id = v_property and is_primary) then
    update public.property_photos set is_primary = true
     where id = (select id from public.property_photos where property_id = v_property
                  order by position, created_at, id limit 1);
  end if;
  return null;
end $$;
create trigger property_photos_ensure_primary after insert or delete on public.property_photos
  for each row execute function public.tg_photo_ensure_primary();

-- Détection prudente des doublons (renvoie des candidats, ne bloque rien).
create or replace function public.find_duplicate_contacts(p_phone text, p_email text, p_exclude uuid default null)
returns table (kind text, id uuid, reference text, full_name text, phone text, email text)
language sql stable security invoker set search_path = '' as $$
  select 'acheteur', b.id, b.reference, btrim(b.last_name || ' ' || coalesce(b.first_names, '')), b.phone, b.email
    from public.buyers b
   where b.id is distinct from p_exclude
     and ((public.normalize_phone(p_phone) is not null and public.normalize_phone(b.phone) = public.normalize_phone(p_phone))
       or (nullif(btrim(p_email), '') is not null and lower(b.email) = lower(btrim(p_email))))
  union all
  select 'proprietaire', o.id, o.reference, btrim(o.last_name || ' ' || coalesce(o.first_names, '')), o.phone_primary, o.email
    from public.owners o
   where o.id is distinct from p_exclude
     and ((public.normalize_phone(p_phone) is not null and public.normalize_phone(o.phone_primary) = public.normalize_phone(p_phone))
       or (nullif(btrim(p_email), '') is not null and lower(o.email) = lower(btrim(p_email))))
$$;

revoke execute on function public.tg_mandate_owner_check() from public, anon, authenticated;
revoke execute on function public.tg_property_publication() from public, anon, authenticated;
revoke execute on function public.tg_photo_primary() from public, anon, authenticated;
revoke execute on function public.tg_photo_ensure_primary() from public, anon, authenticated;
revoke execute on function public.publication_blockers(uuid) from public, anon;
revoke execute on function public.publication_blockers_row(public.properties) from public, anon, authenticated;
revoke execute on function public.find_duplicate_contacts(text, text, uuid) from public, anon;


-- ===== 20261009000300_commercial_finances.sql =====
-- =====================================================================
-- 0003 — Suivi commercial (demandes, échanges, visites, négociations,
--        transactions), finances, tâches, documents générés.
-- =====================================================================

create type public.inquiry_status as enum ('nouveau', 'en_cours', 'traite', 'converti', 'sans_suite', 'spam');
create type public.inquiry_source as enum ('site_web', 'whatsapp', 'telephone', 'autre');
create type public.interaction_channel as enum ('appel', 'whatsapp', 'email', 'sms', 'rencontre', 'visite', 'autre');
create type public.visit_status as enum ('a_confirmer', 'confirmee', 'effectuee', 'reportee', 'annulee', 'sans_suite');
create type public.transaction_status as enum (
  'negociation', 'offre_en_attente', 'offre_acceptee_sous_conditions', 'dossier_en_cours',
  'vente_conclue', 'annulee', 'abandonnee'
);
create type public.offer_status as enum ('en_attente', 'acceptee', 'refusee', 'expiree', 'retiree');
create type public.payment_method as enum ('especes', 'virement', 'mobile_money', 'cheque', 'autre');
create type public.revenue_type as enum ('commission', 'honoraires', 'frais_dossier', 'autre');
create type public.revenue_status as enum ('prevu', 'exigible', 'partiel', 'encaisse', 'annule');
create type public.task_priority as enum ('basse', 'normale', 'haute', 'urgente');
create type public.task_status as enum ('a_faire', 'en_cours', 'terminee', 'reportee', 'annulee');

-- ---------------------------------------------------------------------
-- Demandes web / WhatsApp / téléphone
-- ---------------------------------------------------------------------
create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  phone text not null check (char_length(phone) between 6 and 30),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  property_id uuid references public.properties (id) on delete set null,
  property_reference_input text check (property_reference_input is null or char_length(property_reference_input) <= 40),
  message text not null check (char_length(btrim(message)) between 5 and 2000),
  contact_preference public.contact_preference not null default 'telephone',
  consent boolean not null default false,
  consent_text text,
  source public.inquiry_source not null default 'site_web',
  status public.inquiry_status not null default 'nouveau',
  buyer_id uuid references public.buyers (id) on delete set null,
  handled_by uuid references public.profiles (id) on delete set null,
  client_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index inquiries_status_idx on public.inquiries (status, created_at desc);
create index inquiries_phone_idx on public.inquiries (public.normalize_phone(phone), created_at desc);
create index inquiries_fp_idx on public.inquiries (client_fingerprint, created_at desc);
create trigger inquiries_reference before insert on public.inquiries
  for each row execute function public.tg_set_reference('DEM');
create trigger inquiries_updated_at before update on public.inquiries
  for each row execute function public.tg_set_updated_at();
create trigger inquiries_status_history after insert or update of status on public.inquiries
  for each row execute function public.tg_status_history('status');

-- ---------------------------------------------------------------------
-- Historique des échanges
-- ---------------------------------------------------------------------
create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid references public.buyers (id) on delete restrict,
  owner_id uuid references public.owners (id) on delete restrict,
  property_id uuid references public.properties (id) on delete restrict,
  inquiry_id uuid references public.inquiries (id) on delete set null,
  channel public.interaction_channel not null,
  direction text not null default 'sortant' check (direction in ('entrant', 'sortant')),
  occurred_at timestamptz not null default now(),
  summary text not null check (char_length(btrim(summary)) between 2 and 4000),
  next_action text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (buyer_id is not null or owner_id is not null)
);
create index interactions_buyer_idx on public.interactions (buyer_id, occurred_at desc);
create index interactions_owner_idx on public.interactions (owner_id, occurred_at desc);

-- Met à jour la date de dernier contact du prospect.
create or replace function public.tg_interaction_last_contact() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.buyer_id is not null then
    update public.buyers set last_contact_at = greatest(coalesce(last_contact_at, new.occurred_at), new.occurred_at)
     where id = new.buyer_id;
  end if;
  return new;
end $$;
create trigger interactions_last_contact after insert on public.interactions
  for each row execute function public.tg_interaction_last_contact();

-- ---------------------------------------------------------------------
-- Visites
-- ---------------------------------------------------------------------
create table public.visits (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  property_id uuid not null references public.properties (id) on delete restrict,
  buyer_id uuid not null references public.buyers (id) on delete restrict,
  scheduled_at timestamptz not null,
  location text,
  status public.visit_status not null default 'a_confirmer',
  report text,
  interest_level smallint check (interest_level is null or interest_level between 1 and 5),
  objections text,
  next_action text,
  follow_up_at timestamptz,
  notes text,
  agent_id uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index visits_scheduled_idx on public.visits (scheduled_at);
create index visits_property_idx on public.visits (property_id);
create index visits_buyer_idx on public.visits (buyer_id);
create trigger visits_reference before insert on public.visits
  for each row execute function public.tg_set_reference('VIS');
create trigger visits_updated_at before update on public.visits
  for each row execute function public.tg_set_updated_at();
create trigger visits_log after insert or update or delete on public.visits
  for each row execute function public.tg_activity_log();
create trigger visits_status_history after insert or update of status on public.visits
  for each row execute function public.tg_status_history('status');

-- ---------------------------------------------------------------------
-- Transactions (dossiers de vente) et négociations (offres / contre-offres)
-- ---------------------------------------------------------------------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  property_id uuid not null references public.properties (id) on delete restrict,
  buyer_id uuid not null references public.buyers (id) on delete restrict,
  owner_id uuid not null references public.owners (id) on delete restrict,
  mandate_id uuid references public.mandates (id) on delete restrict,
  initial_asking_price numeric(15, 0) check (initial_asking_price is null or initial_asking_price >= 0),
  agreed_price numeric(15, 0) check (agreed_price is null or agreed_price > 0),
  status public.transaction_status not null default 'negociation',
  conditions text,
  fees numeric(15, 0) check (fees is null or fees >= 0),
  commission_rule_id uuid references public.commission_rules (id) on delete restrict,
  commission_agreed numeric(15, 0) check (commission_agreed is null or commission_agreed >= 0),
  offer_accepted_date date,
  compromise_date date,
  deed_date date,
  concluded_date date,
  abandon_reason text,
  supporting_docs_note text,
  notes text,
  agent_id uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'vente_conclue' or (agreed_price is not null and concluded_date is not null)),
  check (status not in ('annulee', 'abandonnee') or coalesce(btrim(abandon_reason), '') <> '')
);
create index transactions_status_idx on public.transactions (status);
create index transactions_property_idx on public.transactions (property_id);
create unique index transactions_one_concluded on public.transactions (property_id) where status = 'vente_conclue';
create trigger transactions_reference before insert on public.transactions
  for each row execute function public.tg_set_reference('TRX');
create trigger transactions_updated_at before update on public.transactions
  for each row execute function public.tg_set_updated_at();
create trigger transactions_log after insert or update or delete on public.transactions
  for each row execute function public.tg_activity_log();
create trigger transactions_status_history after insert or update of status on public.transactions
  for each row execute function public.tg_status_history('status');

create table public.negotiations (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id) on delete restrict,
  offer_kind text not null check (offer_kind in ('offre', 'contre_offre')),
  from_party text not null check (from_party in ('acheteur', 'vendeur')),
  amount numeric(15, 0) not null check (amount > 0),
  offered_at timestamptz not null default now(),
  valid_until date,
  status public.offer_status not null default 'en_attente',
  conditions text,
  notes text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index negotiations_trx_idx on public.negotiations (transaction_id, offered_at);
create trigger negotiations_updated_at before update on public.negotiations
  for each row execute function public.tg_set_updated_at();
create trigger negotiations_log after insert or update or delete on public.negotiations
  for each row execute function public.tg_activity_log();

-- Cohérence de la transaction et effets sur le bien.
create or replace function public.tg_transaction_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  select owner_id into v_owner from public.properties where id = new.property_id;
  if v_owner is not null and v_owner <> new.owner_id then
    raise exception 'Le vendeur de la transaction ne correspond pas au propriétaire du bien' using errcode = '23514';
  end if;
  if new.mandate_id is not null and not exists (
    select 1 from public.mandates m where m.id = new.mandate_id and m.property_id = new.property_id
  ) then
    raise exception 'Le mandat ne concerne pas ce bien' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status in ('vente_conclue', 'annulee', 'abandonnee')
     and new.status is distinct from old.status and not public.is_admin()
     and auth.uid() is not null then
    raise exception 'Seul un administrateur peut rouvrir un dossier clôturé' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger transactions_rules before insert or update on public.transactions
  for each row execute function public.tg_transaction_rules();

create or replace function public.tg_transaction_effects() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is not distinct from (case when tg_op = 'UPDATE' then old.status end) then
    return new;
  end if;
  if new.status = 'vente_conclue' then
    -- Retire le bien du catalogue public, conserve tout l'historique.
    update public.properties
       set commercial_status = 'vendu', unavailability_reason = 'Vendu (' || new.reference || ')'
     where id = new.property_id;
    update public.buyers set status = 'converti' where id = new.buyer_id and status <> 'archive';
    update public.mandates set status = 'cloture'
     where property_id = new.property_id and status = 'actif';
    -- Commission devenue exigible (montant convenu, sinon à compléter).
    if not exists (select 1 from public.financial_entries f where f.transaction_id = new.id and f.entry_type = 'commission') then
      insert into public.financial_entries (entry_date, entry_type, transaction_id, amount_expected, status, notes)
      values ((now() at time zone 'Africa/Abidjan')::date, 'commission', new.id,
              coalesce(new.commission_agreed, 0), 'exigible',
              'Créée automatiquement à la conclusion de ' || new.reference);
    end if;
  elsif new.status in ('negociation', 'offre_en_attente', 'offre_acceptee_sous_conditions', 'dossier_en_cours') then
    update public.properties set commercial_status = 'sous_negociation'
     where id = new.property_id and commercial_status = 'publie';
  elsif new.status in ('annulee', 'abandonnee') then
    -- Le bien redevient publié s'il n'y a plus d'autre dossier actif.
    if not exists (
      select 1 from public.transactions t
       where t.property_id = new.property_id and t.id <> new.id
         and t.status in ('negociation', 'offre_en_attente', 'offre_acceptee_sous_conditions', 'dossier_en_cours')
    ) then
      update public.properties set commercial_status = 'publie'
       where id = new.property_id and commercial_status = 'sous_negociation';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Finances : recettes (avec encaissements partiels), dépenses
-- ---------------------------------------------------------------------
create table public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  entry_date date not null default current_date,
  entry_type public.revenue_type not null,
  transaction_id uuid references public.transactions (id) on delete restrict,
  description text,
  amount_expected numeric(15, 0) not null check (amount_expected >= 0),
  amount_received numeric(15, 0) not null default 0,
  balance numeric(15, 0) generated always as (amount_expected - amount_received) stored,
  last_payment_date date,
  status public.revenue_status not null default 'prevu',
  notes text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index financial_entries_date_idx on public.financial_entries (entry_date);
create index financial_entries_trx_idx on public.financial_entries (transaction_id);
create trigger financial_entries_reference before insert on public.financial_entries
  for each row execute function public.tg_set_reference('REC');
create trigger financial_entries_updated_at before update on public.financial_entries
  for each row execute function public.tg_set_updated_at();
create trigger financial_entries_log after insert or update or delete on public.financial_entries
  for each row execute function public.tg_activity_log();
create trigger financial_entries_status_history after insert or update of status on public.financial_entries
  for each row execute function public.tg_status_history('status');

create trigger transactions_effects after insert or update of status on public.transactions
  for each row execute function public.tg_transaction_effects();

-- Encaissements : jamais modifiés ni supprimés ; une correction = une ligne négative motivée.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  financial_entry_id uuid not null references public.financial_entries (id) on delete restrict,
  paid_on date not null,
  amount numeric(15, 0) not null check (amount <> 0),
  method public.payment_method not null,
  receipt_path text,
  payment_reference text,
  is_correction boolean not null default false,
  note text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (amount > 0 or (is_correction and coalesce(btrim(note), '') <> ''))
);
create index payments_entry_idx on public.payments (financial_entry_id);
create trigger payments_log after insert on public.payments
  for each row execute function public.tg_activity_log();

create or replace function public.tg_payments_recompute() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_total numeric(15, 0);
  v_last date;
  e public.financial_entries;
begin
  select * into e from public.financial_entries where id = new.financial_entry_id for update;
  if e.status = 'annule' then
    raise exception 'Impossible d''encaisser sur une recette annulée' using errcode = '23514';
  end if;
  select coalesce(sum(amount), 0), max(paid_on) into v_total, v_last
    from public.payments where financial_entry_id = new.financial_entry_id;
  if v_total < 0 then
    raise exception 'Le total encaissé ne peut pas être négatif' using errcode = '23514';
  end if;
  if v_total > e.amount_expected then
    raise exception 'Le total encaissé (%) dépasse le montant attendu (%)', v_total, e.amount_expected using errcode = '23514';
  end if;
  update public.financial_entries
     set amount_received = v_total,
         last_payment_date = v_last,
         status = case
           when v_total = 0 then (case when e.status in ('partiel', 'encaisse') then 'exigible' else e.status end)
           when v_total < e.amount_expected then 'partiel'
           else 'encaisse' end::public.revenue_status
   where id = new.financial_entry_id;
  return new;
end $$;
create trigger payments_recompute after insert on public.payments
  for each row execute function public.tg_payments_recompute();

-- Le montant encaissé n'est modifiable qu'à travers les encaissements.
create or replace function public.tg_financial_entry_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() = 1 and new.amount_received is distinct from old.amount_received then
    raise exception 'Le montant encaissé est calculé à partir des encaissements' using errcode = '23514';
  end if;
  if pg_trigger_depth() = 1 and new.status is distinct from old.status
     and (new.status in ('partiel', 'encaisse') or old.status in ('partiel', 'encaisse') and new.status <> 'annule') then
    raise exception 'Les statuts « partiel » et « encaissé » sont calculés à partir des encaissements' using errcode = '23514';
  end if;
  if new.amount_expected < new.amount_received then
    raise exception 'Le montant attendu ne peut pas être inférieur au montant déjà encaissé' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger financial_entries_guard before update on public.financial_entries
  for each row execute function public.tg_financial_entry_guard();

create or replace function public.tg_financial_entry_insert_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.amount_received := 0;
  if new.status in ('partiel', 'encaisse') then
    new.status := 'exigible';
  end if;
  return new;
end $$;
create trigger financial_entries_insert_guard before insert on public.financial_entries
  for each row execute function public.tg_financial_entry_insert_guard();

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  expense_date date not null default current_date,
  category text not null check (char_length(category) between 2 and 80),
  description text not null check (char_length(btrim(description)) between 2 and 500),
  amount numeric(15, 0) not null check (amount > 0),
  payment_method public.payment_method not null,
  receipt_path text,
  property_id uuid references public.properties (id) on delete restrict,
  transaction_id uuid references public.transactions (id) on delete restrict,
  notes text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_date_idx on public.expenses (expense_date);
create trigger expenses_reference before insert on public.expenses
  for each row execute function public.tg_set_reference('DEP');
create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.tg_set_updated_at();
create trigger expenses_log after insert or update or delete on public.expenses
  for each row execute function public.tg_activity_log();

-- ---------------------------------------------------------------------
-- Tâches et rappels
-- ---------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 2 and 200),
  description text,
  category text,
  priority public.task_priority not null default 'normale',
  due_at timestamptz,
  property_id uuid references public.properties (id) on delete set null,
  buyer_id uuid references public.buyers (id) on delete set null,
  owner_id uuid references public.owners (id) on delete set null,
  status public.task_status not null default 'a_faire',
  result text,
  next_action text,
  assigned_to uuid references public.profiles (id) on delete set null default auth.uid(),
  completed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_due_idx on public.tasks (status, due_at);

create or replace function public.tg_task_completed() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'terminee' and (tg_op = 'INSERT' or old.status <> 'terminee') then
    new.completed_at := now();
  elsif new.status <> 'terminee' then
    new.completed_at := null;
  end if;
  return new;
end $$;
create trigger tasks_completed before insert or update on public.tasks
  for each row execute function public.tg_task_completed();
create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- Documents générés (métadonnées)
-- ---------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  doc_type text not null check (char_length(doc_type) between 2 and 60),
  title text not null,
  entity_type text,
  entity_id uuid,
  storage_path text,
  contains_personal_data boolean not null default true,
  is_template_validated boolean not null default false,
  generated_by uuid references public.profiles (id) on delete set null default auth.uid(),
  generated_at timestamptz not null default now()
);
create index documents_entity_idx on public.documents (entity_type, entity_id);
create trigger documents_reference before insert on public.documents
  for each row execute function public.tg_set_reference('DOC');
create trigger documents_log after insert or delete on public.documents
  for each row execute function public.tg_activity_log();

revoke execute on function public.tg_interaction_last_contact() from public, anon, authenticated;
revoke execute on function public.tg_transaction_rules() from public, anon, authenticated;
revoke execute on function public.tg_transaction_effects() from public, anon, authenticated;
revoke execute on function public.tg_payments_recompute() from public, anon, authenticated;
revoke execute on function public.tg_financial_entry_guard() from public, anon, authenticated;
revoke execute on function public.tg_financial_entry_insert_guard() from public, anon, authenticated;
revoke execute on function public.tg_task_completed() from public, anon, authenticated;


-- ===== 20261009000400_rls.sql =====
-- =====================================================================
-- 0004 — Row Level Security et privilèges
-- Principe : moindre privilège. Le rôle anon n'a AUCUN accès direct
-- aux tables métier ; le site public passe par des vues restreintes
-- et la fonction submit_inquiry().
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'owners', 'properties', 'property_photos', 'property_documents', 'document_checks',
    'buyers', 'commission_rules', 'mandates', 'inquiries', 'interactions', 'visits',
    'transactions', 'negotiations', 'financial_entries', 'payments', 'expenses',
    'tasks', 'documents'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t);
  end loop;
end $$;

create policy owners_read on public.owners for select to authenticated using (public.can_sales());
create policy owners_insert on public.owners for insert to authenticated with check (public.can_sales());
create policy owners_update on public.owners for update to authenticated using (public.can_sales()) with check (public.can_sales());
create policy owners_delete on public.owners for delete to authenticated using (public.is_admin());

create policy properties_read on public.properties for select to authenticated using (public.is_staff());
create policy properties_insert on public.properties for insert to authenticated with check (public.can_sales());
create policy properties_update on public.properties for update to authenticated using (public.can_sales()) with check (public.can_sales());
create policy properties_delete on public.properties for delete to authenticated using (public.is_admin());

create policy property_photos_read on public.property_photos for select to authenticated using (public.is_staff());
create policy property_photos_write on public.property_photos for insert to authenticated with check (public.can_sales());
create policy property_photos_update on public.property_photos for update to authenticated using (public.can_sales()) with check (public.can_sales());
create policy property_photos_delete on public.property_photos for delete to authenticated using (public.can_sales());

create policy property_documents_read on public.property_documents for select to authenticated using (public.can_sales());
create policy property_documents_insert on public.property_documents for insert to authenticated with check (public.can_sales());
create policy property_documents_delete on public.property_documents for delete to authenticated using (public.is_admin());

create policy document_checks_read on public.document_checks for select to authenticated using (public.can_sales());
create policy document_checks_insert on public.document_checks for insert to authenticated with check (public.can_sales());
create policy document_checks_update on public.document_checks for update to authenticated using (public.can_sales()) with check (public.can_sales());
create policy document_checks_delete on public.document_checks for delete to authenticated using (public.is_admin());

create policy buyers_read on public.buyers for select to authenticated using (public.can_sales());
create policy buyers_insert on public.buyers for insert to authenticated with check (public.can_sales());
create policy buyers_update on public.buyers for update to authenticated using (public.can_sales()) with check (public.can_sales());
create policy buyers_delete on public.buyers for delete to authenticated using (public.is_admin());

create policy commission_rules_read on public.commission_rules for select to authenticated using (public.is_staff());
create policy commission_rules_insert on public.commission_rules for insert to authenticated with check (public.can_finance());
create policy commission_rules_update on public.commission_rules for update to authenticated using (public.can_finance()) with check (public.can_finance());
create policy commission_rules_delete on public.commission_rules for delete to authenticated using (public.is_admin());

create policy mandates_read on public.mandates for select to authenticated using (public.can_sales() or public.can_finance());
create policy mandates_insert on public.mandates for insert to authenticated with check (public.can_sales());
create policy mandates_update on public.mandates for update to authenticated using (public.can_sales()) with check (public.can_sales());
create policy mandates_delete on public.mandates for delete to authenticated using (public.is_admin());

create policy inquiries_read on public.inquiries for select to authenticated using (public.can_sales());
create policy inquiries_insert on public.inquiries for insert to authenticated with check (public.can_sales());
create policy inquiries_update on public.inquiries for update to authenticated using (public.can_sales()) with check (public.can_sales());
create policy inquiries_delete on public.inquiries for delete to authenticated using (public.is_admin());

create policy interactions_read on public.interactions for select to authenticated using (public.can_sales());
create policy interactions_insert on public.interactions for insert to authenticated with check (public.can_sales());
create policy interactions_update on public.interactions for update to authenticated
  using (public.is_admin() or (public.can_sales() and created_by = auth.uid()))
  with check (public.can_sales());
create policy interactions_delete on public.interactions for delete to authenticated using (public.is_admin());

create policy visits_read on public.visits for select to authenticated using (public.can_sales());
create policy visits_insert on public.visits for insert to authenticated with check (public.can_sales());
create policy visits_update on public.visits for update to authenticated using (public.can_sales()) with check (public.can_sales());
create policy visits_delete on public.visits for delete to authenticated using (public.is_admin());

create policy transactions_read on public.transactions for select to authenticated using (public.can_sales() or public.can_finance());
create policy transactions_insert on public.transactions for insert to authenticated with check (public.can_negotiate());
create policy transactions_update on public.transactions for update to authenticated using (public.can_negotiate()) with check (public.can_negotiate());
create policy transactions_delete on public.transactions for delete to authenticated using (public.is_admin());

create policy negotiations_read on public.negotiations for select to authenticated using (public.can_sales());
create policy negotiations_insert on public.negotiations for insert to authenticated with check (public.can_negotiate());
create policy negotiations_update on public.negotiations for update to authenticated using (public.can_negotiate()) with check (public.can_negotiate());
create policy negotiations_delete on public.negotiations for delete to authenticated using (public.is_admin());

-- Finances : jamais de suppression via l'API (annulation par statut, corrections tracées).
create policy financial_entries_read on public.financial_entries for select to authenticated using (public.can_finance());
create policy financial_entries_insert on public.financial_entries for insert to authenticated with check (public.can_finance());
create policy financial_entries_update on public.financial_entries for update to authenticated using (public.can_finance()) with check (public.can_finance());
revoke delete on public.financial_entries from authenticated;

create policy payments_read on public.payments for select to authenticated using (public.can_finance());
create policy payments_insert on public.payments for insert to authenticated with check (public.can_finance());
revoke update, delete on public.payments from authenticated;

create policy expenses_read on public.expenses for select to authenticated using (public.can_finance());
create policy expenses_insert on public.expenses for insert to authenticated with check (public.can_finance());
create policy expenses_update on public.expenses for update to authenticated using (public.can_finance()) with check (public.can_finance());
create policy expenses_delete on public.expenses for delete to authenticated using (public.is_admin());

create policy tasks_read on public.tasks for select to authenticated using (public.is_staff());
create policy tasks_insert on public.tasks for insert to authenticated with check (public.is_staff());
create policy tasks_update on public.tasks for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid()));

create policy documents_read on public.documents for select to authenticated using (public.is_staff());
create policy documents_insert on public.documents for insert to authenticated with check (public.is_staff());
create policy documents_delete on public.documents for delete to authenticated using (public.is_admin());
revoke update on public.documents from authenticated;


-- ===== 20261009000500_stockage.sql =====
-- =====================================================================
-- 0005 — Stockage : photos publiques séparées des documents privés.
-- Limites de taille et de formats appliquées au niveau du bucket.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('property-photos', 'property-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('private-documents', 'private-documents', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  ('finance-receipts', 'finance-receipts', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Photos : lecture publique via l'URL du bucket public ; écriture réservée à l'équipe commerciale.
create policy "photos_staff_select" on storage.objects for select to authenticated
  using (bucket_id = 'property-photos' and public.is_staff());
create policy "photos_sales_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'property-photos' and public.can_sales());
create policy "photos_sales_update" on storage.objects for update to authenticated
  using (bucket_id = 'property-photos' and public.can_sales())
  with check (bucket_id = 'property-photos' and public.can_sales());
create policy "photos_sales_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'property-photos' and public.can_sales());

-- Documents confidentiels : accès authentifié + URL signée temporaire côté client.
create policy "docs_sales_select" on storage.objects for select to authenticated
  using (bucket_id = 'private-documents' and public.can_sales());
create policy "docs_sales_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'private-documents' and public.can_sales());
create policy "docs_admin_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'private-documents' and public.is_admin());

-- Justificatifs financiers.
create policy "receipts_finance_select" on storage.objects for select to authenticated
  using (bucket_id = 'finance-receipts' and public.can_finance());
create policy "receipts_finance_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'finance-receipts' and public.can_finance());
create policy "receipts_admin_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'finance-receipts' and public.is_admin());


-- ===== 20261009000600_site_public_et_rapports.sql =====
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


-- ===== 20261010000700_corrections_audit.sql =====
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
