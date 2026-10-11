# Déploiement sur Cloudflare Pages

Règles (cahier des charges § 13) : préproduction d’abord, aucune dépense ni achat de domaine sans autorisation
explicite, mise en production uniquement après validation du propriétaire.

## 1. Préparer

- Projet Supabase configuré et testé ([SUPABASE.md](SUPABASE.md)).
- Code poussé sur GitHub (compte de l’agence).
- Tests au vert : `npm run check`.

## 2. Créer le projet Pages

1. https://dash.cloudflare.com → *Workers & Pages → Create → Pages → Connect to Git*.
2. Choisir le dépôt, branche de production : `main` (les autres branches donnent des URL de préproduction).
3. Paramètres de build :
   - *Framework preset* : Vite (ou aucun)
   - *Root directory* : `unimob`
   - *Build command* : `npm run build`
   - *Build output directory* : `dist`
4. *Environment variables* (Production **et** Preview) :

   | Variable | Valeur |
   |---|---|
   | `VITE_SUPABASE_URL` | URL du projet Supabase |
   | `VITE_SUPABASE_ANON_KEY` | clé publique « anon » |
   | `VITE_SITE_URL` | URL publique du site (ex. `https://agence.pages.dev`) — **lue au build** pour écrire l’URL absolue du sitemap dans `robots.txt` |
   | `SUPABASE_URL` / `SUPABASE_ANON_KEY` | mêmes valeurs que les deux premières (utilisées par les Pages Functions : sitemap et aperçus de partage) |
   | `NODE_VERSION` | `22` |

   Aucune autre variable n’est nécessaire. **Jamais** la clé `service_role`.

## 3. Fichiers déjà prévus

- `public/_redirects` : routage de l’application (toutes les URL → `index.html`).
- `public/_headers` : en-têtes de sécurité (`nosniff`, `DENY` frames, HSTS), `noindex` + `no-store` sur `/admin`.
- `robots.txt` : généré au build (exclut `/admin`, `/connexion`, `/mot-de-passe` ; sitemap en URL absolue si `VITE_SITE_URL` est défini).
- `functions/sitemap.xml.ts` : sitemap dynamique des annonces publiées (biens fictifs exclus), lu par tranches de 1000.
- `functions/biens/[reference].ts` : sert chaque fiche bien avec son titre, sa description et sa photo dans le HTML,
  pour que les aperçus WhatsApp/Facebook soient corrects (les robots de partage n’exécutent pas le JavaScript).
  Après déploiement, vérifiez un lien avec l’outil de débogage de partage de Facebook.

## 4. Préproduction puis production

1. Déployez une branche `preprod` → URL `https://preprod.<projet>.pages.dev`.
2. Dans Supabase, ajoutez cette URL aux *Redirect URLs*.
3. Recettez avec la liste de [TESTS.md § Recette manuelle](TESTS.md#recette-manuelle-avant-mise-en-production).
4. Vérifiez une sauvegarde et une restauration ([SAUVEGARDE.md](SAUVEGARDE.md)).
5. Après **validation écrite du propriétaire**, fusionnez dans `main`.

## 5. Nom de domaine (facultatif, payant)

Un domaine personnalisé (`.ci` ou `.com`) est un achat : ne le faites qu’avec l’accord du propriétaire.
Ensuite : *Pages → Custom domains*, puis mettez à jour *Site URL* et *Redirect URLs* dans Supabase.
