-- =====================================================================
-- À exécuter sur la base RESTAURÉE, juste après pg_restore (voir docs/SAUVEGARDE.md).
-- Contrôles uniquement, rejouable : s'arrête sur « Restauration NON conforme » si un
-- point de sécurité manque. Le test du formulaire public est annulé (rollback) :
-- aucune demande n'est conservée.
-- =====================================================================

do $$
declare
  -- Seules fonctions privilégiées qu'un visiteur peut appeler (même liste que
  -- tests/db/securite.test.ts) : à mettre à jour si une migration en ajoute une.
  attendues constant text[] := array['can_finance', 'can_negotiate', 'can_sales', 'current_app_role',
                                     'has_role', 'is_admin', 'is_staff', 'submit_inquiry'];
  vues constant text[] := array['public_agency_info', 'public_properties', 'public_property_photos'];
  erreurs text[] := '{}';
  v text;
  liste text[];
begin
  -- 1. Extensions (hors sauvegarde) : sans elles, les vues du site public ne sont pas recréées.
  select coalesce(array_agg(x), '{}') into liste
    from unnest(array['pgcrypto', 'unaccent', 'pg_trgm']) x
   where not exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
                      where e.extname = x and n.nspname = 'extensions');
  if liste <> '{}' then
    erreurs := array_append(erreurs, format('extensions absentes du schéma extensions : %s', array_to_string(liste, ', ')));
  end if;
  if to_regprocedure('extensions.unaccent(text)') is not null
     and not has_function_privilege('anon', 'extensions.unaccent(text)', 'execute') then
    erreurs := array_append(erreurs, 'extensions.unaccent(text) non exécutable par le visiteur (catalogue et recherche du site hors service)');
  end if;

  -- 2. Vues du site public présentes et en lecture seule pour le visiteur.
  foreach v in array vues loop
    if to_regclass('public.' || v) is null then
      erreurs := array_append(erreurs, format('vue public.%s absente (site public hors service)', v));
    elsif not has_table_privilege('anon', 'public.' || v, 'select')
       or has_table_privilege('anon', 'public.' || v, 'insert, update, delete, truncate') then
      erreurs := array_append(erreurs, format('public.%s : le visiteur doit avoir la lecture seule', v));
    end if;
  end loop;
  if to_regclass('public.properties_title_trgm') is null then
    erreurs := array_append(erreurs, 'index de recherche public.properties_title_trgm absent');
  end if;

  -- 3. Aucune table publique sans RLS.
  select coalesce(array_agg(c.relname::text order by c.relname), '{}') into liste
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if liste <> '{}' then
    erreurs := array_append(erreurs, format('tables sans RLS : %s', array_to_string(liste, ', ')));
  end if;

  -- 4. Le visiteur n'accède directement à aucune table : seulement aux vues ci-dessus.
  select coalesce(array_agg(c.relname::text order by c.relname), '{}') into liste
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and c.relname <> all (vues)
     and has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger');
  if liste <> '{}' then
    erreurs := array_append(erreurs, format('tables ou vues accessibles au visiteur : %s', array_to_string(liste, ', ')));
  end if;

  -- 5. Fonctions SECURITY DEFINER appelables par un visiteur : exactement la liste attendue.
  --    Une restauration qui hérite des privilèges par défaut de Supabase les ouvre toutes
  --    (promote_to_admin, run_maintenance, next_reference…).
  select coalesce(array_agg(p.proname::text order by p.proname), '{}') into liste
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
  if liste <> attendues then
    erreurs := array_append(erreurs, format('fonctions privilégiées appelables par un visiteur : %s (attendu : %s)',
                                            coalesce(nullif(array_to_string(liste, ', '), ''), 'aucune'),
                                            array_to_string(attendues, ', ')));
  end if;

  -- 6. Fonctions de déclencheur et promotion d'administrateur : jamais appelables via l'API.
  select coalesce(array_agg(p.proname::text order by p.proname), '{}') into liste
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.prorettype = 'trigger'::regtype or p.proname = 'promote_to_admin')
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'));
  if liste <> '{}' then
    erreurs := array_append(erreurs, format('fonctions internes appelables via l''API : %s', array_to_string(liste, ', ')));
  end if;

  -- 7. Schéma privé fermé et clé du formulaire présente.
  if to_regclass('private.app_secret') is null then
    erreurs := array_append(erreurs, 'table private.app_secret absente (formulaire public hors service)');
  else
    if (select count(*) from private.app_secret) <> 1 then
      erreurs := array_append(erreurs, 'clé private.app_secret absente (formulaire public hors service)');
    end if;
    if has_schema_privilege('anon', 'private', 'usage') or has_schema_privilege('authenticated', 'private', 'usage') then
      erreurs := array_append(erreurs, 'le schéma private est accessible via l''API');
    end if;
  end if;

  -- 8. L'API garde l'accès au schéma public, et l'équipe aux tables (RLS décide ensuite).
  select coalesce(array_agg(r), '{}') into liste
    from unnest(array['anon', 'authenticated', 'service_role']) r
   where not has_schema_privilege(r, 'public', 'usage');
  if liste <> '{}' then
    erreurs := array_append(erreurs, format('schéma public inaccessible pour : %s', array_to_string(liste, ', ')));
  end if;
  if not coalesce(has_table_privilege('authenticated', to_regclass('public.properties'), 'select, insert, update, delete'), false) then
    erreurs := array_append(erreurs, 'les membres connectés n''ont plus accès à public.properties');
  end if;

  if erreurs <> '{}' then
    raise exception E'Restauration NON conforme :\n- %', array_to_string(erreurs, E'\n- ');
  end if;
  raise notice 'Contrôles de sécurité : conformes';
end $$;

-- Test réel en tant que visiteur du site (rôle anon), annulé ensuite.
begin;
set local "request.jwt.claims" = '{"role":"anon"}';
set local role anon;
-- count(search_text) évalue les colonnes calculées (unaccent) que lit le site.
select (select count(search_text) from public.public_properties) as biens_visibles_visiteur,
       (select count(*) from public.public_property_photos) as photos_visibles_visiteur,
       public.submit_inquiry(p_full_name => 'Contrôle restauration', p_phone => '+225 01 00 00 00 00',
                             p_message => 'Test après restauration (annulé)', p_consent => true) ->> 'ok'
         as formulaire_ok;
rollback;

-- Nombre de lignes par table : à comparer avec la base d'origine (cette requête seule,
-- en lecture, peut y être exécutée).
select n.nspname as schema, c.relname as table_,
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname),
                                            false, true, '')))[1]::text::bigint as lignes
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'r' and (n.nspname in ('public', 'private') or (n.nspname = 'auth' and c.relname = 'users'))
 order by 1, 2;
