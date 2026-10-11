# Configuration Supabase et création du compte administrateur

Toutes les étapes se font **au nom du propriétaire de l’agence** (compte Supabase personnel ou de l’agence).
Aucune dépense n’est nécessaire avec l’offre gratuite ; vérifiez les quotas au moment de la création
(https://supabase.com/pricing).

## 1. Créer le projet

1. https://supabase.com → *New project*.
2. Région : la plus proche des utilisateurs (ex. Europe de l’Ouest — vérifiez la latence depuis Abidjan).
3. Notez le **mot de passe de la base** dans un gestionnaire de mots de passe (jamais dans le dépôt).

## 2. Appliquer les migrations

Option A0 — le plus simple : *SQL Editor → New query*, collez tout le fichier `supabase/installation_complete.sql`
(les 7 migrations réunies, sans données de démonstration) puis *Run*. Une seule fois, sur un projet vierge.

> **Vous aviez déjà exécuté une version précédente de ce fichier (6 migrations) ?** N’exécutez PAS à nouveau le fichier
> complet : exécutez seulement `supabase/migrations/20261010000700_corrections_audit.sql` (corrections de l’audit,
> dont les privilèges indispensables aux projets Supabase récents).

Option A — éditeur SQL, fichier par fichier : *SQL Editor → New query*, collez puis exécutez **dans l’ordre** chaque fichier de
`supabase/migrations/` :

1. `20261009000100_fondations.sql`
2. `20261009000200_portefeuille.sql`
3. `20261009000300_commercial_finances.sql`
4. `20261009000400_rls.sql`
5. `20261009000500_stockage.sql`
6. `20261009000600_site_public_et_rapports.sql`
7. `20261010000700_corrections_audit.sql`

> Les projets Supabase récents n’accordent plus automatiquement de privilèges sur les nouvelles tables aux rôles
> `anon` et `authenticated`. La migration 7 les accorde explicitement (la sécurité reste assurée par RLS) :
> sans elle, l’espace privé renverrait « permission denied ».

Option B — CLI Supabase : `npx supabase link --project-ref <ref>` puis `npx supabase db push`.

Option C — **installation par Claude** avec le connecteur Supabase (aucun mot de passe ni clé à transmettre) :

1. Le propriétaire connecte le connecteur **Supabase** sur https://claude.ai/customize/connectors
   (connexion à son compte Supabase, autorisation de l’organisation qui contient le projet).
2. Il ouvre une **nouvelle** session Claude Code sur ce dépôt (les connecteurs sont lus au démarrage d’une session)
   et demande l’installation de la base.
3. Claude suit la procédure [ci-dessous](#procédure-pour-claude-connecteur-supabase).

> **Attention à la traduction automatique du navigateur** (Chrome « Traduire cette page ») : elle transforme
> `select` en « sélectionner » et peut abîmer le SQL copié depuis GitHub. Désactivez-la sur github.com et
> supabase.com avant de copier ou d’exécuter du SQL (menu ⋮ → *Traduire…* → *Ne jamais traduire ce site*).

Vérification : *Table Editor* doit afficher les tables (properties, owners…) avec le badge **RLS enabled**.
*Storage* doit afficher 3 buckets : `property-photos` (public), `private-documents` (privé), `finance-receipts` (privé).

## 3. (Projet de test uniquement) Données fictives

Exécutez `supabase/seed.sql` dans l’éditeur SQL. **Ne pas le faire en production.**

## 4. Sécuriser l’authentification

*Authentication → Sign In / Providers* :

- **Désactiver « Allow new users to sign up »** (aucune inscription publique).
- Laisser « Confirm email » activé.

*Authentication → URL Configuration* :

- *Site URL* : l’URL du site (ex. `https://votre-site.pages.dev`).
- *Redirect URLs* : ajouter `https://votre-site.pages.dev/mot-de-passe` (réinitialisation du mot de passe)
  et, en développement, `http://localhost:5173/mot-de-passe`.

> Le service d’envoi de courriels intégré de Supabase est limité (quelques messages par heure).
> Pour une équipe, configurez un SMTP (*Authentication → Emails → SMTP*) — cela peut être payant.

## 5. Créer le compte administrateur (sans mot de passe en dur)

1. Vérifiez d’abord *Authentication → URL Configuration → Site URL* (étape 4) : le lien d’invitation y renvoie.
2. *Authentication → Users → Add user → Send invitation* avec l’adresse de l’administrateur.
3. L’administrateur ouvre le courriel : le lien ouvre la page **« Choisir votre mot de passe »** du site
   (l’application reconnaît les liens d’invitation et de réinitialisation). 12 caractères minimum, lettres et chiffres.
4. Dans *SQL Editor*, exécutez (en remplaçant l’adresse) :

   ```sql
   select public.promote_to_admin('adresse@exemple.com');
   ```

   Cette fonction n’est exécutable que depuis l’éditeur SQL (rôle `postgres`), jamais via l’API.
5. Connectez-vous sur `/connexion`, puis ouvrez *Paramètres* pour saisir nom, coordonnées, WhatsApp, zones.

## 6. Ajouter des membres d’équipe

Invitez-les comme à l’étape 5.2. Leur compte apparaît dans *Espace privé → Utilisateurs* **sans aucun accès** ;
l’administrateur choisit le rôle (Agent, Assistant, Comptable, Administrateur) puis l’active.

## 7. Récupérer les clés pour l’application

*Project Settings → API* :

- `Project URL` → `VITE_SUPABASE_URL`
- `anon public` → `VITE_SUPABASE_ANON_KEY`

La clé `service_role` **ne sert pas** à l’application. Ne la copiez nulle part.

## 8. Contrôles après installation

Dans *SQL Editor* :

```sql
-- Aucune table publique sans RLS (doit renvoyer 0 ligne)
select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- Fonctions privilégiées exécutables par un visiteur (doit lister uniquement les fonctions
-- de rôle — can_*, has_role, is_admin, is_staff, current_app_role — et submit_inquiry)
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');

-- Les vues publiques sont en lecture seule (doit renvoyer false)
select has_table_privilege('anon', 'public.public_agency_info', 'update');

-- La fonction de promotion n'est pas appelable via l'API (doit renvoyer false)
select has_function_privilege('anon', 'public.promote_to_admin(text)', 'execute');

-- Un membre de l'équipe a bien accès aux tables (doit renvoyer true)
select has_table_privilege('authenticated', 'public.properties', 'select');
```

Lancez aussi *Advisors → Security Advisor*. Avertissement attendu : les vues `public_properties`,
`public_property_photos` et `public_agency_info` sont signalées « security definer view » ;
c’est voulu : elles n’exposent que les champs publics des biens publiés et conformes (voir SECURITE.md).

## 9. Réglage « Max rows » de l’API

*Project Settings → Data API → Max rows* vaut 1000 par défaut. L’application lit les exports, rapports et le sitemap
**par tranches de 1000** : laissez cette valeur (ne la baissez pas en dessous de 1000).

## Procédure pour Claude (connecteur Supabase)

À suivre par une session Claude Code dont le connecteur Supabase est actif. Les fichiers se trouvent sur la branche
`claude/unimob-consulting-specs-pd1roi` (`git fetch origin claude/unimob-consulting-specs-pd1roi`, puis
`git show origin/claude/unimob-consulting-specs-pd1roi:unimob/supabase/migrations/<fichier>`).

Interdits : créer, mettre en pause, restaurer ou supprimer un projet ; confirmer un coût (`confirm_cost`) ; activer une
option payante ; lire ou afficher la clé `service_role` ou le mot de passe de la base ; charger `seed.sql` sans accord
explicite du propriétaire ; toucher à un projet autre que celui désigné par le propriétaire.

1. `list_projects` : identifier le projet. S’il y en a plusieurs, demander lequel au propriétaire.
2. Vérifier qu’il est vierge (`execute_sql`) :
   ```sql
   select (select count(*) from pg_tables where schemaname = 'public') as tables,
          (select count(*) from storage.buckets) as buckets;
   ```
   Attendu : `0` et `0`. Si ce n’est pas le cas, s’arrêter et comparer avec `list_migrations` avant toute action.
3. `apply_migration` pour **chacun** des fichiers de `supabase/migrations/`, dans l’ordre des noms, avec
   `name` = nom du fichier sans `.sql` et `query` = contenu exact du fichier. S’arrêter à la première erreur et la
   rapporter telle quelle (ne pas modifier le SQL sur le projet pour « faire passer »).
4. Contrôles (`execute_sql`) — les résultats attendus sont entre parenthèses :
   - la requête de l’étape 2 (`23` tables, `3` buckets) ;
   - les contrôles de la section 8 ci-dessus (0 table sans RLS ; seules les fonctions de rôle et `submit_inquiry`
     exécutables par `anon` ; `false`, `false`, `true`) ;
   - `select count(*) from public.agency_settings;` (`1`).
5. `get_advisors` (type `security`) : seules les alertes « security definer view » sur les trois vues publiques sont
   attendues (documentées dans SECURITE.md). Rapporter toute autre alerte.
6. Rapporter au propriétaire ce qui a été **réellement** vérifié, puis lui rappeler les réglages qu’il fait lui-même
   dans le tableau de bord : section 4 (inscriptions désactivées, *Site URL*, *Redirect URLs*) et section 5
   (invitation de l’administrateur). Après l’invitation, la promotion peut être faite par Claude :
   `select public.promote_to_admin('adresse@exemple.com');` (adresse donnée par le propriétaire).
7. Récupérer l’URL du projet et la clé publique `anon` (`get_project_url`, clé « anon » / *publishable*) pour le
   déploiement Cloudflare Pages ; ce sont des valeurs publiques. Ne jamais récupérer ni écrire la clé `service_role`.
