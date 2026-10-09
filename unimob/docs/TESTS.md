# Tests et rapport d’exécution

Tous les résultats ci-dessous ont été **réellement obtenus** le 9 octobre 2026 dans l’environnement de
développement (Linux, Node 22, PostgreSQL 16.15, Chromium via Playwright 1.56). Aucune donnée personnelle réelle :
uniquement des données fictives.

## Résumé

| Suite | Commande | Fichiers | Tests | Résultat |
|---|---|---|---|---|
| Unitaires (règles métier, composants) | `npm test` | 2 | 25 | ✅ 25/25 |
| Base de données (RLS, contraintes, déclencheurs, finances) | `npm run test:db` | 4 | 92 | ✅ 92/92 |
| Bout en bout (navigateur réel + API réelle) | `npm run test:e2e` | 3 | 21 | ✅ 21/21 |
| Lint + types + build de production | `npm run lint`, `npm run typecheck`, `npm run build` | — | — | ✅ sans erreur |
| Sauvegarde → restauration | `scripts/backup.sh` + `pg_restore` | — | — | ✅ (voir SAUVEGARDE.md) |

## Ce que couvre chaque suite

### Base de données — `tests/db/` (92 tests)

Exécutée sur PostgreSQL avec un *shim* reproduisant Supabase (rôles `anon`/`authenticated`, `auth.uid()`,
schéma `storage`) **et les privilèges par défaut larges de Supabase**, pour prouver que ce sont bien les
politiques RLS — et non l’absence de droits — qui protègent les données. Chaque test se connecte avec le rôle
et le JWT d’un utilisateur, comme le ferait l’API.

- `securite.test.ts` (47) : RLS activée sur toutes les tables ; 23 tables illisibles par un visiteur anonyme ;
  vue publique sans champs privés ; aucune fonction privilégiée sensible exécutable par `anon` ; compte sans rôle
  ou désactivé = aucune donnée ; impossibilité de s’auto-promouvoir ; matrice des rôles (agent sans finances,
  comptable sans contacts, assistant sans transactions, suppression réservée à l’admin) ; journal non modifiable
  même par l’admin ; stockage : dépôt anonyme refusé, buckets privés, formats/tailles.
- `biens.test.ts` (19) : référence unique automatique, doublons refusés (casse/espaces), validations, montants
  numériques exacts, comptage tableau de bord, brouillon privé, conditions de publication (et assouplissement
  par paramètres), publication/dépublication avec historique, motif de retrait, photo principale unique,
  cohérence mandat/propriétaire, un seul mandat actif, pas de suppression en cascade, doublons de contacts,
  biens correspondant à un prospect.
- `demandes-ventes.test.ts` (11) : demande publique enregistrée, liée au bien publié, illisible par les visiteurs ;
  validations et tentatives d’injection ; champ piège anti-robot ; limitation de débit ; conversion en prospect ;
  visite liée au bien et au prospect ; offre acceptée ≠ vente ; vente conclue → bien retiré du catalogue,
  historique conservé, mandat clôturé, commission exigible créée ; abandon motivé ; réouverture réservée à l’admin.
- `finances.test.ts` (15) : encaissements partiels, solde, statut calculé ; dépassement refusé ; corrections
  négatives motivées, encaissements non modifiables/supprimables ; recettes non supprimables ; estimation de
  commission (%, minimum, forfait, arrondi) ; distinction estimée / convenue / exigible / encaissée / solde ;
  rapport financier cohérent avec les données sources ; tableau de bord du comptable ; tâches en retard.

### Unitaires — `tests/unit/` (25 tests)

Formats XOF et fuseau Africa/Abidjan, conversion des dates, estimation de commission (identique à la base),
liens WhatsApp, export CSV (neutralisation des formules Excel, colonnes sensibles interdites), contrôle des
fichiers, validation du formulaire public, permissions par rôle, garde des routes privées, conversion des
formulaires, nettoyage des recherches, robustesse des mots de passe, envoi du formulaire public.

### Bout en bout — `tests/e2e/` (21 tests)

Pile locale : PostgreSQL + **GoTrue (Supabase Auth) 2.180** + **PostgREST 12.2** (les mêmes logiciels que Supabase)
derrière un proxy `/auth/v1` et `/rest/v1`. Le **build de production** est servi et piloté dans Chromium.

- `01-public.spec.ts` (7) : accueil, catalogue filtré, fiche bien sans données du propriétaire, bien non publié
  inaccessible, formulaire (erreurs puis envoi enregistré en base), **accès direct à l’API refusé** pour
  6 tables privées et pour l’écriture directe, SEO et `noindex`.
- `02-admin.spec.ts` (10) : redirection vers la connexion, identifiants incorrects, compte sans rôle bloqué,
  menus et pages selon le rôle ; parcours complet : paramètres → propriétaire → bien (référence auto) →
  publication bloquée → vérification → mandat actif → publication → visible sur le site → demande → prospect →
  visite (heure d’Abidjan) → dossier → offre → vente conclue (refusée sans date, puis acceptée) → bien retiré du
  site, historique conservé → comptable : encaissement partiel, correction motivée, soldes exacts, dépense →
  journal d’activité.
- `mobile.spec.ts` (4, profil **Pixel 7 / Android**) : catalogue et fiche sans défilement horizontal, menu mobile,
  taille des cibles tactiles, espace privé (menu repliable, listes en cartes).

## Ce qui n’est PAS couvert automatiquement (limites honnêtes)

- **Envoi réel de photos et documents** : l’API Storage de Supabase n’est pas émulée localement. Les politiques
  de stockage sont testées en SQL, la compression/validation côté navigateur en unitaire, mais le chargement
  complet doit être testé manuellement sur un projet Supabase (préproduction).
- **Courriels** (invitation, réinitialisation du mot de passe) : non testés (dépendent du SMTP Supabase).
- **Génération PDF** : le code est compilé et typé, mais le contenu des PDF n’est pas vérifié automatiquement.
- **Appareils réels** : Android est émulé (viewport, tactile) dans Chromium ; pas de test sur téléphone physique,
  ni sur Safari/iOS.
- **Projet Supabase réel** : non disponible dans l’environnement de développement ; à valider en préproduction.

## Lancer les tests

```bash
cd unimob
npm test                       # unitaires
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
```

Bout en bout (Linux x86-64) : télécharger les binaires officiels puis lancer :

```bash
# PostgREST : https://github.com/PostgREST/postgrest/releases (v12.2.3, linux-static-x64)
# GoTrue    : https://github.com/supabase/auth/releases (v2.180.0, auth-v2.180.0-x86.tar.gz)
GOTRUE_BIN=/chemin/auth POSTGREST_BIN=/chemin/postgrest npm run test:e2e
```

Les clés JWT et mots de passe de test sont générés aléatoirement à chaque exécution et écrits dans
`tests/e2e/.state.json` (exclu de Git).

## Recette manuelle avant mise en production

À réaliser sur la préproduction, avec des données fictives, sur un téléphone Android et un ordinateur :

- [ ] Connexion, déconnexion, mot de passe oublié (réception du courriel, lien fonctionnel).
- [ ] Ajout de photos depuis la galerie **et** l’appareil photo ; photo principale ; ordre ; suppression.
- [ ] Ajout puis ouverture d’un document confidentiel (lien temporaire) ; le lien expire après 5 minutes.
- [ ] Publication d’un bien avec photo ; affichage sur le site ; dépublication.
- [ ] Formulaire public depuis un téléphone ; réception dans *Demandes*.
- [ ] Bouton WhatsApp : ouverture de WhatsApp avec le message et la référence.
- [ ] PDF : fiche bien, fiche prospect, relevé de commissions, modèle de mandat (lisibilité, accents).
- [ ] Export CSV ouvert dans Excel/LibreOffice (accents, colonnes).
- [ ] Tentative d’accès à `/admin` sans être connecté ; avec un compte sans rôle.
- [ ] Sauvegarde puis restauration dans un projet de test.
- [ ] Security Advisor Supabase sans alerte autre que les vues publiques documentées.
