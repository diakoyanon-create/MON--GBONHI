# Installation locale

## Prérequis

- Node.js 20 ou plus récent (testé avec Node 22) et npm
- Un projet Supabase (gratuit) — voir [SUPABASE.md](SUPABASE.md)
- Pour les tests base de données : PostgreSQL 15+ local (testé avec PostgreSQL 16)

## Étapes

```bash
git clone <URL du dépôt>
cd MON--GBONHI/unimob
npm install
cp .env.example .env.local
```

Éditez `.env.local` :

```
VITE_SUPABASE_URL=https://<identifiant>.supabase.co
VITE_SUPABASE_ANON_KEY=<clé publique « anon »>
VITE_SITE_URL=http://localhost:5173
```

> ⚠️ Ne mettez **jamais** la clé `service_role` ni un mot de passe dans un fichier `VITE_*` :
> tout ce qui commence par `VITE_` est inclus dans le code envoyé aux navigateurs.
> `.env.local` est exclu de Git par `.gitignore`.

Lancez l’application :

```bash
npm run dev
```

- Site public : http://localhost:5173
- Espace privé : http://localhost:5173/connexion

Sans `.env.local`, l’application affiche un écran « Configuration requise » au lieu de planter.

## Données de démonstration

`supabase/seed.sql` contient des données **entièrement fictives** (noms suffixés `-DEMO`,
numéros `+225 00 00 …`, adresses `exemple.invalid`). Tous les biens sont marqués « Exemple fictif »
sur le site. Chargez-les uniquement sur un projet de test (voir SUPABASE.md, étape 3).

## Base de test locale (développeurs)

```bash
# PostgreSQL local avec l’utilisateur postgres / mot de passe postgres
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run db:reset
npm run test:db
```

`db:reset` crée la base `unimob_test` avec un *shim* minimal reproduisant Supabase (rôles `anon`,
`authenticated`, schémas `auth` et `storage`), applique les migrations puis les données fictives.
Le shim (`tests/db/supabase-shim.sql`) ne doit jamais être appliqué sur un vrai projet Supabase.
