# Plateforme immobilière — Côte d’Ivoire

Application web complète pour une agence immobilière (activité initiale : **vente**) :
un **espace privé sécurisé** de gestion et un **site public** de présentation des biens,
reliés à une base de données commune (Supabase / PostgreSQL).

Réalisée selon le *Cahier des charges — Plateforme immobilière complète pour une agence en Côte d’Ivoire* (v1.0, octobre 2026).
Nom de l’agence, logo, coordonnées, zones et commissions sont **provisoires et modifiables** dans *Paramètres*.

## Fonctionnalités

| Espace privé | Site public |
|---|---|
| Tableau de bord (indicateurs distincts, filtre par période) | Accueil (recherche, biens récents/à la une, zones, contact) |
| Biens : fiche complète, photos, documents privés, publication contrôlée, aperçu, historique | Catalogue avec filtres (type, commune, quartier, budget, superficie, chambres) et pagination |
| Propriétaires + fiche de contrôle des documents | Fiche bien : galerie, prix XOF, caractéristiques, WhatsApp prérempli, formulaire, biens similaires |
| Acheteurs/prospects : besoins, doublons, biens correspondants, échanges | À propos, Contact, Mentions légales, Confidentialité |
| Mandats, demandes (web/WhatsApp/téléphone), visites (calendrier) | SEO : titres, descriptions, Open Graph, sitemap, robots.txt |
| Négociations, offres/contre-offres, transactions | PWA installable (sans cache des données) |
| Finances : recettes, encaissements partiels, corrections tracées, dépenses, commissions | |
| PDF (fiches, relevés, rapports, modèles de mandat), exports CSV, rapports | |
| Paramètres, utilisateurs et rôles, journal d’activité | |

Détail : [docs/FONCTIONNALITES.md](docs/FONCTIONNALITES.md).

## Pile technique

React 19 + TypeScript + Vite · Tailwind CSS 4 · React Router · Supabase (PostgreSQL, Auth, Storage, RLS) · Cloudflare Pages · jsPDF.

## Démarrage rapide (développement)

```bash
cd unimob
npm install
cp .env.example .env.local      # puis renseigner l’URL et la clé « anon » de VOTRE projet Supabase
npm run dev                     # http://localhost:5173
```

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` | Vérification TypeScript + build de production (`dist/`) |
| `npm run lint` / `npm run typecheck` | Qualité du code |
| `npm test` | Tests unitaires (interface, règles métier) |
| `npm run test:db` | Tests base de données : RLS, règles métier, finances (PostgreSQL local requis) |
| `npm run test:e2e` | Tests de bout en bout Playwright (pile locale, voir [docs/TESTS.md](docs/TESTS.md)) |
| `npm run check` | Lint + types + unitaires + base de données |

## Structure

```
unimob/
├── supabase/migrations/   Schéma SQL versionné, RLS, stockage, fonctions (6 migrations)
├── supabase/seed.sql      Données de démonstration explicitement fictives
├── src/
│   ├── api/               Accès aux données (PostgREST, RPC)
│   ├── auth/              Session, rôles, garde des routes privées
│   ├── domain/            Règles métier pures (libellés, commissions, CSV, fichiers, validation)
│   ├── resources/         Moteur générique listes/formulaires + configuration des modules
│   ├── pages/admin/       Espace privé    ·  pages/public/  Site public
│   └── lib/               Supabase, formats XOF / Africa/Abidjan, PDF, SEO, PWA
├── functions/             Cloudflare Pages Function (sitemap.xml)
├── tests/unit|db|e2e/     Tests automatisés
├── scripts/               Réinitialisation base de test, sauvegarde
└── docs/                  Guides
```

## Documentation

- [Installation locale](docs/INSTALLATION.md)
- [Configuration Supabase et compte administrateur](docs/SUPABASE.md)
- [Déploiement Cloudflare Pages](docs/DEPLOIEMENT.md)
- [Sauvegarde et restauration](docs/SAUVEGARDE.md)
- [Guide d’utilisation (débutant)](docs/GUIDE_UTILISATEUR.md)
- [Tests et rapport d’exécution](docs/TESTS.md)
- [Rapport de sécurité](docs/SECURITE.md)
- [Fonctionnalités, limites connues, prochaines étapes](docs/FONCTIONNALITES.md)
- [Coûts possibles et services tiers](docs/COUTS.md)
