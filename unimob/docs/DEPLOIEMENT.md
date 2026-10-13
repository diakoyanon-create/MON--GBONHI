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
   | `SUPABASE_URL` / `SUPABASE_ANON_KEY` | mêmes valeurs que les deux premières (utilisées par les Pages Functions : sitemap et aperçus de partage ; à défaut, elles lisent `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`) |
   | `NODE_VERSION` | `22` |

   Aucune autre variable n’est nécessaire. **Jamais** la clé `service_role`.

## 3. Fichiers déjà prévus

- `public/_redirects` : routage de l’application (toutes les URL → `index.html`).
- `public/_headers` : en-têtes de sécurité (`nosniff`, `DENY` frames, HSTS), `noindex` + `no-store` sur `/admin`,
  `noindex` sur `/connexion`.
- `robots.txt` : généré au build par `vite.config.ts` (exclut `/admin`, `/connexion`, `/mot-de-passe`,
  `/mot-de-passe-oublie` ; sitemap en URL absolue si `VITE_SITE_URL` est défini).
- Le sitemap, l’adresse canonique et l’aperçu de partage des fiches utilisent l’adresse par laquelle le site est
  consulté (voir § 5 pour un domaine personnalisé).
- `functions/sitemap.xml.ts` : sitemap dynamique des annonces publiées (biens fictifs exclus), lu par tranches de 1000.
- `functions/biens/[reference].ts` : sert chaque fiche bien avec son titre, sa description et sa photo dans le HTML,
  pour que les aperçus WhatsApp/Facebook soient corrects (les robots de partage n’exécutent pas le JavaScript).
  Après déploiement, vérifiez un lien avec l’outil de débogage de partage de Facebook.

## 4. Préproduction puis production

1. Déployez une branche `preprod` → URL `https://preprod.<projet>.pages.dev`.
2. Dans Supabase (*Authentication → URL Configuration*), ajoutez `https://preprod.<projet>.pages.dev/mot-de-passe`
   aux *Redirect URLs* (réinitialisation du mot de passe).
3. Recettez avec la liste de [TESTS.md § Recette manuelle](TESTS.md#recette-manuelle-avant-mise-en-production).
4. Vérifiez une sauvegarde et une restauration ([SAUVEGARDE.md](SAUVEGARDE.md)).
5. Après **validation écrite du propriétaire**, fusionnez dans `main`.

## 5. Nom de domaine (facultatif, payant)

Un domaine personnalisé (`.ci` ou `.com`) est un achat : ne le faites qu’avec l’**accord écrit du propriétaire**.
Les étapes suivantes ne coûtent rien. Une fois le domaine acheté :

1. *Workers & Pages → projet → Custom domains → Set up a custom domain* : ajoutez le domaine et suivez l’assistant
   (un domaine racine doit avoir ses DNS chez Cloudflare, offre gratuite). Attendez l’état *Active*.
2. *Settings → Variables and Secrets* (ou *Environment variables*), environnement **Production** :
   `VITE_SITE_URL` = `https://<domaine>` (sans `/` final). Cette variable est lue **au build** : relancez un
   déploiement de production (menu du dernier déploiement de production → *Retry deployment*, ou nouvelle fusion
   dans `main`). Sinon `robots.txt` continue d’annoncer le sitemap de `<projet>.pages.dev`.
3. Redirigez `<projet>.pages.dev` vers le domaine. Le sitemap, l’adresse canonique et les aperçus reprennent
   l’adresse consultée : sans redirection, les moteurs indexent les deux adresses. Dans le tableau de bord du compte
   Cloudflare, *Bulk Redirects* (gratuit, quotas à vérifier au moment de la configuration) :
   - créez une liste avec la redirection `<projet>.pages.dev` → `https://<domaine>`, code 301, en cochant
     *Preserve query string*, *Subpath matching* et *Preserve path suffix* ; **ne cochez pas** *Include subdomains*,
     qui redirigerait aussi la préproduction `preprod.<projet>.pages.dev` ;
   - créez une règle *Bulk Redirect* qui utilise cette liste.
4. Supabase → *Authentication → URL Configuration* : *Site URL* = `https://<domaine>` (le lien d’invitation y
   renvoie) ; dans *Redirect URLs*, ajoutez `https://<domaine>/mot-de-passe` et gardez l’adresse de préproduction.
5. Vérifiez : `https://<domaine>/robots.txt` affiche `Sitemap: https://<domaine>/sitemap.xml` ;
   `https://<projet>.pages.dev/biens` redirige vers `https://<domaine>/biens` ; le lien reçu après « Mot de passe
   oublié ? » (page de connexion du domaine) ramène sur le domaine.
