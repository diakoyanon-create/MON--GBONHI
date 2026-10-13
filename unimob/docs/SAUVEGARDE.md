# Sauvegarde et restauration

> Git **n’est pas** une sauvegarde de la base de données : il ne contient que le code et les migrations.

## Ce qu’il faut sauvegarder

| Élément | Où | Méthode | Fréquence conseillée |
|---|---|---|---|
| Base de données (biens, contacts, finances, journaux, comptes) | Supabase PostgreSQL | `scripts/backup.sh` (pg_dump) | Quotidienne ou au minimum hebdomadaire |
| Photos et documents | Supabase Storage (3 buckets) | Téléchargement depuis le tableau de bord ou CLI | Hebdomadaire et après ajout de documents importants |
| Code et migrations | GitHub | Dépôt Git | À chaque modification |
| Paramètres (clés, URL) | Gestionnaire de mots de passe | Manuel | À chaque changement |

## Risques de l’offre gratuite (à vérifier sur https://supabase.com/pricing au moment du déploiement)

- Les sauvegardes automatiques téléchargeables et la restauration à un instant donné sont réservées aux offres payantes.
- Un projet gratuit inactif peut être **mis en pause** après une période sans activité.
- Les quotas (taille de base, stockage, bande passante) sont limités.

→ Avec l’offre gratuite, **les sauvegardes manuelles ci-dessous sont indispensables.**

## Sauvegarder la base

Prérequis : outils PostgreSQL (`pg_dump`, `pg_restore`, `psql`) en version ≥ celle de Supabase.

1. Supabase → *Project Settings → Database → Connection string* (URI, mode *Session*). Elle contient le mot de passe.
2. Dans un terminal (la variable n’est pas enregistrée dans un fichier) :

   ```bash
   cd unimob
   export SUPABASE_DB_URL='postgresql://postgres.<ref>:<MOT_DE_PASSE>@<hôte>:5432/postgres'
   ./scripts/backup.sh
   unset SUPABASE_DB_URL
   ```

3. Le script sauvegarde les schémas `public` (données métier), `private` (clé technique du formulaire anti-spam)
   et `auth` (comptes), **avec les droits d’accès** (indispensables : sans eux, une restauration rendrait
   certaines fonctions appelables par n’importe qui). Il crée `sauvegardes/base-AAAAMMJJ-HHMMSS.dump`
   (droits 600, dossier exclu de Git) et **vérifie** que le fichier contient les données des biens, la clé
   privée, les droits et les vues du site public. Sinon il affiche une erreur.
4. Copiez le fichier sur un support séparé (disque externe chiffré, stockage cloud privé de l’agence).

## Sauvegarder les fichiers

*Storage* → chaque bucket → sélectionner les fichiers → *Download*. Pour automatiser, Supabase Storage propose
une API compatible S3 utilisable avec un outil de synchronisation (à configurer et tester ; la clé d’accès S3
est un secret à garder hors du dépôt).
Les documents privés et justificatifs contiennent des données personnelles : conservez-les chiffrés.

## Restaurer (procédure testée)

Restaurer de préférence dans un **nouveau projet Supabase** (préproduction), jamais directement sur la production
sans avoir vérifié le résultat. Les trois étapes sont **obligatoires**, dans cet ordre, avec l’utilisateur `postgres` :

```bash
cd unimob
export TARGET_DB_URL='postgresql://postgres.<ref-cible>:<MOT_DE_PASSE>@<hôte>:5432/postgres'
# 1. Préparer la cible (extensions, privilèges par défaut)
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f supabase/avant_restauration.sql
# 2. Restaurer
pg_restore --no-owner --clean --if-exists -d "$TARGET_DB_URL" sauvegardes/base-AAAAMMJJ-HHMMSS.dump
# 3. Contrôler
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f supabase/apres_restauration.sql
unset TARGET_DB_URL
```

**Pourquoi l’étape 1** (`supabase/avant_restauration.sql`, rejouable, ne touche à aucune donnée) :

- les extensions `unaccent` et `pg_trgm` (schéma `extensions`) ne font pas partie de la sauvegarde et ne sont pas
  activées sur un projet neuf. Sans elles, `pg_restore` ne recrée ni les vues `public_properties` et
  `public_property_photos` (catalogue, fiches et sitemap en erreur) ni l’index de recherche. Le script accorde aussi
  explicitement l’exécution de `unaccent` au visiteur (indispensable sur un projet qui retire les droits par défaut) ;
- la sauvegarde n’enregistre les droits que par différence avec ceux de PostgreSQL. Sur Supabase, chaque objet
  recréé reçoit en plus tous les droits pour `anon`, `authenticated` et `service_role`. Sans le retrait de ces
  privilèges par défaut, `promote_to_admin`, `run_maintenance` et les autres fonctions privilégiées deviennent
  appelables par n’importe quel visiteur, et les vues publiques modifiables. Les privilèges par défaut d’origine
  sont rétablis à la fin de la restauration.

**Messages de l’étape 2.** Selon la cible, `pg_restore` peut afficher les erreurs suivantes, puis
« errors ignored on restore » (code de sortie 1) :

- « cannot drop schema public because other objects depend on it » et « schema "public" already exists » ;
- si les migrations sont déjà appliquées sur la cible : « cannot drop function public.is_staff() because other
  objects depend on it » (de même pour `is_admin`, `can_sales` et `can_finance`, utilisées par les règles d’accès
  aux fichiers), puis « function "is_staff" already exists ». Ces fonctions restent en place, identiques ;
- sur un projet Supabase, des messages « already exists » ou « must be owner » pour le schéma `auth`
  (géré par Supabase) : vérifiez ensuite le nombre de comptes (`auth.users`) affiché à l’étape 3.

Ces messages sont sans conséquence **uniquement si l’étape 1 a été faite et si l’étape 3 réussit**. Tout autre
message (en particulier « does not exist ») doit être examiné.

**Étape 3** (`supabase/apres_restauration.sql`, rejouable) : le script contrôle les extensions, la présence et la
lecture seule des vues publiques, la RLS sur toutes les tables, l’absence d’accès direct du visiteur aux tables,
la liste **exacte** des fonctions privilégiées appelables par un visiteur (`can_finance`, `can_negotiate`,
`can_sales`, `current_app_role`, `has_role`, `is_admin`, `is_staff`, `submit_inquiry`), les fonctions internes
(déclencheurs, `promote_to_admin`) fermées à l’API, le schéma `private` et sa clé, l’accès de l’équipe aux tables.
Il affiche « Contrôles de sécurité : conformes », puis il teste le site en tant que visiteur : biens et photos
visibles, et une demande envoyée par le formulaire (`formulaire_ok` = `true`), annulée aussitôt. Il affiche enfin
le nombre de lignes de chaque table. Comparez-le avec la base d’origine : la dernière requête du script, en
lecture seule, peut y être exécutée.

S’il s’arrête sur **« Restauration NON conforme »** (suivi de la liste des problèmes), n’utilisez pas cette base
et ne la reliez pas au site. Si l’étape 1 avait été oubliée, refaites les étapes 1, 2 et 3 sur la même cible :
la restauration remplace les objets.

Les buckets et leurs règles d’accès (schéma `storage`) ne sont pas dans ce fichier. Sur un projet neuf, si les
buckets n’existent pas, exécutez `supabase/migrations/20261009000500_stockage.sql` **après** l’étape 2 (ses règles
utilisent les fonctions restaurées), puis restaurez les fichiers. Connectez-vous enfin à l’application pointée sur
ce projet.

### Résultat du test réalisé (13 octobre 2026, PostgreSQL 16 local)

Base d’origine : base de test (données fictives, 8 migrations, privilèges par défaut larges comme sur Supabase,
un compte fictif), sauvegardée avec `scripts/backup.sh`. Restauration selon la procédure ci-dessus dans trois cibles :
projet neuf (simulation Supabase sans `unaccent` ni `pg_trgm`, puis migration de stockage), projet neuf dont le
schéma `public` contient déjà un objet, et préproduction où les migrations sont déjà appliquées.
Dans les trois cas : contrôles conformes ; droits (tables, vues, fonctions, séquences), politiques, index,
déclencheurs et nombres de lignes des 26 tables identiques à l’origine (seule différence, dans le projet neuf :
le schéma `public` est recréé par `pg_restore`, sans le droit d’usage accordé à tous les rôles ; `anon`,
`authenticated` et `service_role` gardent le leur) ; exactement les 8 fonctions privilégiées attendues pour le
visiteur ; un visiteur lit 4 biens et 4 photos et envoie une demande ; `promote_to_admin` et la modification de
`public_agency_info` lui sont refusées.
Contre-épreuves : sans l’étape 1, la préproduction restaurée laissait un visiteur appeler 32 fonctions privilégiées,
dont `promote_to_admin` (réellement exécutée), modifier `public_agency_info` et accéder à toutes les tables ; le
projet neuf perdait les deux vues publiques et l’index de recherche. Dans les deux cas, l’étape 3 a signalé
« Restauration NON conforme », et rejouer les étapes 1 à 3 a rendu la base conforme.
Les tests précédents (9 et 11 octobre), faits dans une base cible vierge, n’avaient pas révélé ces deux défauts.
Celui du 9 octobre avait montré que la sauvegarde perdait les droits d’accès (corrigé depuis).
Ce test n’a pas encore été fait sur un **vrai projet Supabase** : à refaire lors de la mise en préproduction.

## Tester régulièrement

Une sauvegarde non testée n’est pas une sauvegarde : restaurez au moins **une fois par trimestre** dans un projet
de test et notez la date et le résultat.
