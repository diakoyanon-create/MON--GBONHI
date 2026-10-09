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

Prérequis : outils PostgreSQL (`pg_dump`, `pg_restore`) en version ≥ celle de Supabase.

1. Supabase → *Project Settings → Database → Connection string* (URI, mode *Session*). Elle contient le mot de passe.
2. Dans un terminal (la variable n’est pas enregistrée dans un fichier) :

   ```bash
   cd unimob
   export SUPABASE_DB_URL='postgresql://postgres.<ref>:<MOT_DE_PASSE>@<hôte>:5432/postgres'
   ./scripts/backup.sh
   unset SUPABASE_DB_URL
   ```

3. Le script crée `sauvegardes/base-AAAAMMJJ-HHMMSS.dump` (droits 600, dossier exclu de Git) et **vérifie**
   que le fichier est lisible et contient les données des biens. Sinon il affiche une erreur.
4. Copiez le fichier sur un support séparé (disque externe chiffré, stockage cloud privé de l’agence).

## Sauvegarder les fichiers

*Storage* → chaque bucket → sélectionner les fichiers → *Download*. Pour automatiser, Supabase Storage propose
une API compatible S3 utilisable avec un outil de synchronisation (à configurer et tester ; la clé d’accès S3
est un secret à garder hors du dépôt).
Les documents privés et justificatifs contiennent des données personnelles : conservez-les chiffrés.

## Restaurer (procédure testée)

Restaurer de préférence dans un **nouveau projet Supabase** (préproduction), jamais directement sur la production
sans avoir vérifié le résultat :

```bash
export TARGET_DB_URL='postgresql://postgres.<ref-cible>:<MOT_DE_PASSE>@<hôte>:5432/postgres'
pg_restore --no-owner --clean --if-exists -d "$TARGET_DB_URL" sauvegardes/base-AAAAMMJJ-HHMMSS.dump
```

Le message « schema "public" already exists » est attendu et sans conséquence.
Puis vérifiez :

```sql
select count(*) from properties; select count(*) from owners; select count(*) from payments;
select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;  -- doit être vide
```

et connectez-vous à l’application pointée sur ce projet.

### Résultat du test réalisé (9 octobre 2026, base locale)

Sauvegarde de la base de test (données fictives) avec `scripts/backup.sh`, restauration dans une base vierge
avec `pg_restore` : mêmes nombres de biens (6), propriétaires (3), journaux (28) ; RLS active et 74 politiques restaurées.
Ce test a été fait sur PostgreSQL 16 local, **pas encore sur un vrai projet Supabase** : à refaire lors de la
mise en préproduction.

## Tester régulièrement

Une sauvegarde non testée n’est pas une sauvegarde : restaurez au moins **une fois par trimestre** dans un projet
de test et notez la date et le résultat.
