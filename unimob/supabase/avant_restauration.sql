-- =====================================================================
-- À exécuter sur la base CIBLE, juste avant pg_restore (voir docs/SAUVEGARDE.md).
-- Rejouable. Ne modifie aucune donnée.
-- Exécuter avec le même utilisateur que la restauration (postgres sur Supabase) : les
-- privilèges par défaut retirés ci-dessous sont ceux des objets que cet utilisateur crée.
-- =====================================================================

-- 1. Extensions utilisées par les migrations. Elles sont dans le schéma « extensions »,
--    absent de la sauvegarde ; sans unaccent et pg_trgm, pg_restore ne recrée pas les vues
--    public_properties et public_property_photos (site public vide) ni l'index de recherche.
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;
-- unaccent est évaluée avec les droits du visiteur (vue public_properties) : droit explicite,
-- comme dans la migration 8 (sinon simple avertissement si l'utilisateur n'a pas l'option d'octroi).
grant execute on function extensions.unaccent(text) to anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
              where e.extname in ('pgcrypto', 'unaccent', 'pg_trgm') and n.nspname <> 'extensions') then
    raise exception 'pgcrypto, unaccent ou pg_trgm est installée hors du schéma extensions : restauration impossible en l''état';
  end if;
end $$;

-- 2. Privilèges par défaut retirés dans le schéma public.
--    La sauvegarde n'écrit les droits que par différence avec les droits par défaut de
--    PostgreSQL. Sur Supabase, tout objet créé reçoit en plus les droits complets pour
--    anon, authenticated et service_role : sans ce retrait, la restauration rendrait
--    promote_to_admin, run_maintenance… appelables par un visiteur (cas d'une cible dont
--    pg_restore ne peut pas supprimer le schéma public, par exemple une préproduction où
--    les migrations sont déjà appliquées).
--    Les privilèges par défaut de la base d'origine sont rétablis en fin de restauration
--    (entrées « DEFAULT ACL » de la sauvegarde).
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema public revoke all on functions from anon, authenticated, service_role;
