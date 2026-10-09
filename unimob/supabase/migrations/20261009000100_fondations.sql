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
