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
