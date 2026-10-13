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
