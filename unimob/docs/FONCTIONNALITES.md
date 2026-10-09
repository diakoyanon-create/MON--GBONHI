# Fonctionnalités terminées, restantes et limites connues

Référence : cahier des charges v1.0. « Testé » = couvert par un test automatisé exécuté avec succès.

## Phase 1 — Fondations ✅

| Élément | État |
|---|---|
| Projet React + TypeScript + Vite + Tailwind + React Router | Terminé |
| Schéma PostgreSQL normalisé : 19 tables du cahier + `document_checks`, `payments`, `status_history`, `reference_counters` | Terminé, testé |
| Migrations versionnées (6 fichiers), UUID, références commerciales uniques, dates, contraintes, index | Terminé, testé |
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

## Phase 6 — Tests et déploiement 🟡

| Élément | État |
|---|---|
| Tests automatisés (138 au total) et rapport | Terminé |
| Guides : installation, Supabase, déploiement, sauvegarde, utilisation, sécurité, coûts | Terminé |
| Sauvegarde/restauration testée | Testée sur PostgreSQL local ; **à refaire sur Supabase** |
| Mise en ligne (préproduction, production) | **Non faite** : nécessite les comptes Supabase/Cloudflare du propriétaire |

## Limites connues

1. **Stockage** : envoi de photos/documents et liens signés à valider sur un vrai projet Supabase.
2. **Courriels** (invitation, mot de passe oublié) : dépendent du SMTP Supabase (limité en gratuit).
3. **WhatsApp** : lien `wa.me` avec message prérempli uniquement ; aucune intégration des conversations au CRM.
4. **Notifications externes** (SMS, courriel, push) : non implémentées ; rappels visibles dans l’application seulement.
5. **Création des comptes** : via l’invitation Supabase (le navigateur n’a pas les droits d’administration Auth, par sécurité).
6. **Durée de conservation** : paramétrable mais **sans purge/anonymisation automatique**.
7. **Fusion de doublons** : détection et alerte, fusion manuelle.
8. **Calendrier** : vue hebdomadaire simple, pas de synchronisation Google/Outlook.
9. **Carte** : coordonnées GPS enregistrées en privé, pas de carte affichée.
10. **Location / gestion locative** : hors périmètre (activité initiale = vente).
11. **MFA** pour les administrateurs : non implémentée.
12. **Modèles juridiques** : brouillons à faire valider ; aucune validité juridique garantie.

## Prochaines étapes proposées

1. Créer le projet Supabase de préproduction (compte du propriétaire) et appliquer les migrations.
2. Déployer la préproduction Cloudflare Pages ; dérouler la recette manuelle (TESTS.md).
3. Tester une sauvegarde/restauration sur Supabase.
4. Saisir les vraies informations de l’agence (Paramètres) et faire valider les textes juridiques.
5. Mise en production après validation explicite du propriétaire.
6. Évolutions : purge RGPD automatique, MFA, notifications, carte, gestion locative.
