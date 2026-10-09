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
(les 6 migrations réunies, sans données de démonstration) puis *Run*. Une seule fois, sur un projet vierge.

Option A — éditeur SQL, fichier par fichier : *SQL Editor → New query*, collez puis exécutez **dans l’ordre** chaque fichier de
`supabase/migrations/` :

1. `20261009000100_fondations.sql`
2. `20261009000200_portefeuille.sql`
3. `20261009000300_commercial_finances.sql`
4. `20261009000400_rls.sql`
5. `20261009000500_stockage.sql`
6. `20261009000600_site_public_et_rapports.sql`

Option B — CLI Supabase : `npx supabase link --project-ref <ref>` puis `npx supabase db push`.

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

1. *Authentication → Users → Add user → Send invitation* avec l’adresse de l’administrateur.
2. L’administrateur ouvre le courriel et choisit son mot de passe (12 caractères minimum conseillés).
3. Dans *SQL Editor*, exécutez (en remplaçant l’adresse) :

   ```sql
   select public.promote_to_admin('adresse@exemple.com');
   ```

   Cette fonction n’est exécutable que depuis l’éditeur SQL (rôle `postgres`), jamais via l’API.
4. Connectez-vous sur `/connexion`, puis ouvrez *Paramètres* pour saisir nom, coordonnées, WhatsApp, zones.

## 6. Ajouter des membres d’équipe

Invitez-les comme à l’étape 5.1. Leur compte apparaît dans *Espace privé → Utilisateurs* **sans aucun accès** ;
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
```

Lancez aussi *Advisors → Security Advisor*. Avertissement attendu : les vues `public_properties`,
`public_property_photos` et `public_agency_info` sont signalées « security definer view » ;
c’est voulu : elles n’exposent que les champs publics des biens publiés (voir SECURITE.md).
