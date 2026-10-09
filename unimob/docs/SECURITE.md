# Rapport de sécurité — points principaux vérifiés

État au 9 octobre 2026. « Vérifié » signifie couvert par un test automatisé exécuté avec succès
(voir [TESTS.md](TESTS.md)) ; « À vérifier » signifie dépendant de la configuration du projet Supabase réel.

## Authentification et rôles

| Point | État |
|---|---|
| Connexion / déconnexion / sessions via Supabase Auth | Vérifié (E2E, GoTrue réel) |
| Récupération du mot de passe (lien par courriel, page `/mot-de-passe`, 12 caractères min. avec lettres et chiffres) | Code en place ; envoi du courriel **à vérifier** |
| Aucune inscription publique ne donne accès : un nouveau compte a `role = null`, `is_active = false` | Vérifié (SQL + E2E) |
| Inscription publique désactivée dans Supabase | **À configurer** (SUPABASE.md §4) |
| Premier administrateur créé sans mot de passe en dur (`promote_to_admin`, exécutable seulement côté serveur) | Vérifié |
| Un utilisateur ne peut pas modifier son rôle ; un admin ne peut pas se retirer ses propres droits | Vérifié |
| Rôles admin / agent / assistant / comptable, moindre privilège | Vérifié (matrice testée) |

Matrice des droits (appliquée en base par RLS, reproduite dans l’interface) :

| Données | Admin | Agent | Assistant | Comptable | Visiteur |
|---|---|---|---|---|---|
| Biens (lecture) | ✔ | ✔ | ✔ | ✔ | champs publics des biens publiés |
| Biens, propriétaires, prospects, mandats, visites, demandes (écriture) | ✔ | ✔ | ✔ | ✘ | ✘ |
| Transactions, offres (écriture) | ✔ | ✔ | lecture | lecture (transactions) | ✘ |
| Recettes, encaissements, dépenses, règles de commission | ✔ | ✘ | ✘ | ✔ | ✘ |
| Suppression | ✔ (si aucun lien) | ✘ | ✘ | ✘ | ✘ |
| Paramètres, utilisateurs, journal | ✔ | ✘ | ✘ | ✘ | ✘ |
| Envoyer une demande | via `submit_inquiry` uniquement | | | | ✔ |

## RLS et accès public

- RLS activée sur **toutes** les tables du schéma `public` (test automatique qui échoue sinon).
- Le rôle `anon` n’a **aucun privilège** sur les tables métier (révoqué explicitement, en plus de RLS).
- Le site public lit uniquement : `public_properties`, `public_property_photos`, `public_agency_info`.
  Ces vues filtrent les biens publiés et excluent propriétaire, coordonnées GPS, statut de vérification,
  motif d’indisponibilité, responsables. Elles sont signalées « security definer view » par le linter Supabase :
  c’est le mécanisme voulu (lecture contrôlée de quelques colonnes), documenté ici.
- Les demandes publiques passent par `submit_inquiry()` : validation stricte (longueurs, téléphone, courriel,
  référence, préférence), consentement obligatoire, champ piège anti-robot, limite de 3 demandes / 15 min par
  numéro et 10 / heure par empreinte (IP hachée SHA-256, jamais stockée en clair).
- **Accès directs à l’API testés** (pas seulement l’interface) : lecture et écriture refusées pour les tables privées.
- Requêtes de recherche : caractères de syntaxe PostgREST neutralisés côté client ; les requêtes SQL sont
  paramétrées côté serveur.

## Secrets et stockage

| Point | État |
|---|---|
| Clé `service_role` jamais utilisée par l’application | Vérifié (recherche dans le code : aucune occurrence fonctionnelle) |
| Aucun secret dans une variable `VITE_*` (seules l’URL et la clé publique anon) | Vérifié |
| `.env.example` sans secret ; `.env*` exclus de Git | Vérifié |
| Photos (bucket public) séparées des documents (buckets privés) | Vérifié |
| Documents privés : accès authentifié + lien signé de 5 minutes, consultation journalisée | Code en place ; **à vérifier** sur Supabase |
| Formats et tailles limités (bucket + contrôle navigateur) : photos JPEG/PNG/WebP 5 Mo ; documents PDF/images 15 Mo ; justificatifs 10 Mo | Vérifié (config SQL + unitaires) |
| Noms de fichiers de stockage aléatoires (jamais le nom d’origine) | Vérifié |
| PWA : seuls les fichiers statiques sont mis en cache, jamais l’API ni les pages | Revue de code (`public/sw.js`) |
| En-têtes HTTP de sécurité, `noindex` + `no-store` sur `/admin` | Fichier `_headers` ; **à vérifier** après déploiement |

## Journal d’activité et intégrité

- Modifications des biens, propriétaires, prospects, mandats, visites, transactions, offres, finances,
  commissions, documents et permissions journalisées automatiquement (auteur, date, différences avant/après).
- Exports CSV, publications et consultations de documents journalisés explicitement.
- Mots de passe, jetons et secrets jamais journalisés (champ filtré).
- Le journal n’est ni modifiable, ni supprimable, ni insérable via l’API, **même par l’administrateur** (vérifié).
- Montants en `numeric` exact ; encaissements immuables (corrections par ligne négative motivée) ; statuts
  financiers calculés ; pas de suppression en cascade des dossiers historiques (`ON DELETE RESTRICT`).

## Données personnelles et conformité (à faire valider)

- Consentement recueilli et texte conservé avec chaque demande ; consentements prospects (contact, offres).
- Exports limités aux colonnes autorisées ; colonnes sensibles refusées par le code.
- Textes de confidentialité et mentions légales **provisoires** : à rédiger/valider selon la réglementation
  ivoirienne applicable (protection des données personnelles, exercice de la profession).
- Durée de conservation paramétrable ; **la purge automatique n’est pas encore implémentée** (voir FONCTIONNALITES.md).

## Points d’attention restants

1. Configurer Supabase Auth (inscriptions désactivées, URL de redirection, SMTP) et relancer le Security Advisor.
2. Tester le stockage réel (envoi, liens signés) en préproduction.
3. Activer la double authentification (MFA) pour l’administrateur quand elle sera ajoutée (non implémentée).
4. Faire relire les modèles de mandat et les textes juridiques par un professionnel compétent.
