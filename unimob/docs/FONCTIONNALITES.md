# Fonctionnalités terminées, restantes et limites connues

Référence : cahier des charges v1.0. « Testé » = couvert par un test automatisé exécuté avec succès.

## Phase 1 — Fondations ✅

| Élément | État |
|---|---|
| Projet React + TypeScript + Vite + Tailwind + React Router | Terminé |
| Schéma PostgreSQL normalisé : 19 tables du cahier + `document_checks`, `payments`, `status_history`, `reference_counters` (+ schéma `private`) | Terminé, testé |
| Migrations versionnées (7 fichiers), UUID, références commerciales uniques, dates, contraintes, index | Terminé, testé |
| RLS sur toutes les tables, rôles, stockage public/privé | Terminé, testé |
| Authentification Supabase, garde des routes, compte admin sans mot de passe en dur | Terminé, testé (E2E) |

## Phase 2 — Administration ✅

| Module (§) | État |
|---|---|
| 5.1 Tableau de bord (indicateurs distincts, période) | Terminé, testé |
| 5.2 Biens : CRUD, recherche/filtres, photos (multi, principale, ordre), publication contrôlée, aperçu, historique, archivage | Terminé ; photos **non testées de bout en bout** (stockage non émulé) |
| 5.3 Propriétaires + fiche de contrôle des documents | Terminé, testé (création E2E) |
| 5.5 Acheteurs : statuts, filtres, échanges, correspondances, doublons, export | Terminé, testé |
| 5.4 Mandats : statuts, commission convenue, un seul actif, cohérence propriétaire | Terminé, testé |

## Phase 3 — Suivi commercial ✅

| Module | État |
|---|---|
| 5.6 Demandes web (sécurisées) + saisie WhatsApp/téléphone, conversion en prospect | Terminé, testé |
| 5.7 Visites : statuts, compte rendu, calendrier hebdomadaire, rappels (tâches) | Terminé, testé |
| 5.8 Négociations (offres/contre-offres) et transactions, statuts tracés, effets sur le bien | Terminé, testé |

## Phase 4 — Finances et documents ✅

| Module | État |
|---|---|
| 5.9 Recettes, encaissements partiels, corrections tracées, dépenses, règles de commission, rapport | Terminé, testé |
| 5.10 PDF : fiches bien/propriétaire/prospect/visite/transaction, relevé de commissions, rapports, modèle de mandat | Terminé ; contenu PDF **non vérifié automatiquement** |
| 5.11 Tâches et rappels (aujourd’hui, en retard, échéances) | Terminé, testé |
| 5.12 Rapports filtrables, exports CSV/PDF, paramètres, utilisateurs, journal | Terminé, testé (paramètres, journal) |

## Phase 5 — Site public ✅

Accueil, catalogue (filtres, pagination), détail (galerie, WhatsApp, formulaire, similaires), À propos, Contact,
mentions légales, confidentialité, SEO (titres, descriptions, Open Graph, robots.txt, sitemap dynamique),
biens fictifs identifiés, PWA. Testé (E2E ordinateur + Android émulé).

## Audit et corrections (10-11 octobre 2026) ✅

Audit multi-agents en 6 dimensions avec vérification adversariale : 76 défauts confirmés, corrigés sauf exceptions
listées dans [AUDIT.md](AUDIT.md). Ajouts fonctionnels issus de l’audit :

- Mandats : un mandat n’est « actif » que s’il est signé et en cours de validité ; passage automatique en « Expiré »
  (maintenance lancée à l’ouverture du tableau de bord) ; rappels et échéances affichés au tableau de bord.
- Publication : contrôle permanent (une annonce devenue non conforme disparaît du site, l’équipe est alertée).
- Ventes : réouverture d’une vente par l’administrateur avec annulation de ses effets ; commission estimée créée
  à la conclusion ; dossiers concurrents clos ; dossier clôturé figé (notes modifiables).
- Archivage des propriétaires, anonymisation des personnes (administrateur), suppression des échanges et documents
  (administrateur), rattachement d’une demande à n’importe quel prospect.
- Filtres : biens par prix, prospects par budget et par zone ; exports complets au-delà de 1000 lignes ; export des
  offres et des biens par zone.
- Pièces jointes : justificatif de dépense, mandat signé.
- Site public : sections « À la une » et « Récemment publiés », recherche sans accents, tri immédiat, aperçus de
  partage (Open Graph côté serveur), formulaire accessible avec brouillon conservé, biens fictifs sans formulaire.

## Phase 6 — Tests et déploiement 🟡

| Élément | État |
|---|---|
| Tests automatisés (190 exécutions : 42 unitaires, 124 base, 24 bout en bout dans 2 configurations Supabase) | Terminé |
| Guides : installation, Supabase, déploiement, sauvegarde, utilisation, sécurité, coûts, audit | Terminé |
| Sauvegarde/restauration testée (droits d’accès compris) | Testée sur PostgreSQL local ; **à refaire sur Supabase** |
| Mise en ligne (préproduction, production) | **Non faite** : nécessite les comptes Supabase/Cloudflare du propriétaire |

## Limites connues

1. **Stockage** : envoi de photos/documents et ouverture des documents à valider sur un vrai projet Supabase.
   Un membre commercial peut techniquement télécharger un document privé par l’API sans passer par l’interface
   (pas de trace) ; le verrouiller demande une Edge Function.
2. **Courriels** (invitation, mot de passe oublié) : dépendent du SMTP Supabase (limité en gratuit).
3. **WhatsApp** : lien `wa.me` avec message prérempli uniquement ; aucune intégration des conversations au CRM.
4. **Notifications externes** (SMS, courriel, push) : non implémentées ; rappels visibles dans l’application seulement.
5. **Création des comptes** : via l’invitation Supabase (le navigateur n’a pas les droits d’administration Auth, par sécurité).
6. **Durée de conservation** : paramétrable mais **sans purge automatique** ; anonymisation manuelle disponible.
7. **Devise et fuseau** : XOF et Africa/Abidjan fixes en version 1 (les paramètres correspondants ne sont pas modifiables).
8. **Maintenance quotidienne** (mandats échus → « Expiré ») : lancée à l’ouverture du tableau de bord ; les annonces
   concernées sont de toute façon masquées immédiatement du site. Une planification serveur (pg_cron) est possible.
9. **Fusion de doublons** : détection et alerte, fusion manuelle.
10. **Calendrier** : vue hebdomadaire simple, pas de synchronisation Google/Outlook.
11. **Carte** : coordonnées GPS enregistrées en privé, pas de carte affichée.
12. **Location / gestion locative** : hors périmètre (activité initiale = vente).
13. **MFA** pour les administrateurs : non implémentée.
14. **Modèles juridiques** : brouillons à faire valider ; aucune validité juridique garantie.

## Prochaines étapes proposées

1. Créer le projet Supabase de préproduction (compte du propriétaire) et appliquer les 7 migrations.
2. Déployer la préproduction Cloudflare Pages ; dérouler la recette manuelle (TESTS.md).
3. Tester une sauvegarde/restauration sur Supabase.
4. Saisir les vraies informations de l’agence (Paramètres) et faire valider les textes juridiques.
5. Mise en production après validation explicite du propriétaire.
6. Évolutions : Edge Function pour les documents privés, purge automatique, MFA, notifications, carte, gestion locative.
