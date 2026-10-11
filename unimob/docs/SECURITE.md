# Rapport de sécurité — points principaux vérifiés

État au 11 octobre 2026, après l’audit multi-agents et ses corrections (détail : [AUDIT.md](AUDIT.md)).
« Vérifié » signifie couvert par un test automatisé exécuté avec succès (voir [TESTS.md](TESTS.md)) ;
« À vérifier » signifie dépendant de la configuration du projet Supabase réel ou de Cloudflare.

## Authentification et rôles

| Point | État |
|---|---|
| Connexion / déconnexion / sessions via Supabase Auth | Vérifié (E2E, GoTrue réel) |
| Récupération du mot de passe et invitation : le lien mène à « Choisir votre mot de passe » (12 caractères min., lettres et chiffres) | Redirection testée en unitaire ; envoi des courriels **à vérifier** |
| Aucune inscription publique ne donne accès : un nouveau compte a `role = null`, `is_active = false` | Vérifié (SQL + E2E) |
| Inscription publique désactivée dans Supabase | **À configurer** (SUPABASE.md §4) |
| Premier administrateur créé sans mot de passe en dur (`promote_to_admin`, exécutable seulement côté serveur) | Vérifié (y compris après sauvegarde/restauration) |
| Un utilisateur ne peut modifier ni son rôle, ni son activation, ni le courriel de son profil (synchronisé depuis Auth) | Vérifié |
| Un administrateur ne peut pas se retirer ses propres droits | Vérifié |
| Coupure réseau pendant l’utilisation : la session et la saisie sont conservées (pas d’éjection de l’espace privé) | Revue de code |

Matrice des droits (appliquée en base par RLS, reproduite dans l’interface) :

| Données | Admin | Agent | Assistant | Comptable | Visiteur |
|---|---|---|---|---|---|
| Biens (lecture) | ✔ | ✔ | ✔ | ✔ | champs publics des biens publiés **et conformes** |
| Biens, propriétaires, prospects, mandats, visites, demandes (écriture) | ✔ | ✔ | ✔ | ✘ | ✘ |
| Transactions, offres (écriture) | ✔ | ✔ | lecture | lecture (transactions) | ✘ |
| Dossier clôturé (vente conclue, annulé) : modification | ✔ | notes seulement | ✘ | ✘ | ✘ |
| Recettes, encaissements, dépenses, règles de commission | ✔ | ✘ | ✘ | ✔ | ✘ |
| Historique des statuts | tout | biens, contacts, visites, dossiers | idem agent | biens, dossiers, finances | ✘ |
| Suppression | ✔ (si aucun lien ; jamais les recettes et encaissements) | ✘ | ✘ | ✘ | ✘ |
| Anonymisation d’une personne | ✔ | ✘ | ✘ | ✘ | ✘ |
| Paramètres, utilisateurs, journal | ✔ | ✘ | ✘ | ✘ | ✘ |
| Envoyer une demande | via `submit_inquiry` uniquement | | | | ✔ |

## Privilèges, RLS et accès public

- **Privilèges explicites** : la migration 7 accorde explicitement les droits nécessaires, ce qu’exigent les projets
  Supabase récents (plus de privilèges automatiques). Testé dans les deux configurations : base « stricte » sans
  privilèges par défaut et base aux privilèges par défaut larges (tests base **et** tests de bout en bout).
- RLS activée sur **toutes** les tables du schéma `public` (test automatique qui échoue sinon).
- Le rôle `anon` n’a **aucun privilège** sur les tables métier.
- Les vues publiques (`public_properties`, `public_property_photos`, `public_agency_info`) sont **en lecture seule**
  (défaut corrigé : une vue simple est modifiable par PostgreSQL ; `public_agency_info` l’était par un visiteur).
  Elles ne montrent que les biens publiés **et conformes** aux règles de publication à l’instant présent
  (mandat en cours de validité, vérification, photo, prix, description) et excluent propriétaire, coordonnées GPS,
  statut de vérification et notes. Signalées « security definer view » par le linter Supabase : mécanisme voulu.
- Demandes publiques via `submit_inquiry()` : validation stricte, consentement obligatoire, champ piège anti-robot,
  limite de 3 demandes / 15 min par numéro et 10 / heure par empreinte réseau. Les envois simultanés sont
  **sérialisés** (verrou), ce qui empêche de contourner la limite (testé avec des envois parallèles).
  L’empreinte est un **HMAC** de l’adresse IP avec une clé secrète conservée dans le schéma `private`, inaccessible
  par l’API : ni l’IP ni l’empreinte ne sont lisibles par l’équipe.
- Les règles métier sont appliquées par la base, y compris contre un appel direct à l’API : références
  (format automatique réservé, modification par l’admin seulement), dates de publication, auteur des
  enregistrements (`created_by` non falsifiable), montants encaissés et statuts financiers calculés, remise en
  vente d’un bien vendu réservée à l’admin, changement de propriétaire bloqué tant qu’un mandat est actif.
- **Accès directs à l’API testés** (pas seulement l’interface) : lecture et écriture refusées pour les tables privées.

## Secrets et stockage

| Point | État |
|---|---|
| Clé `service_role` jamais utilisée par l’application | Vérifié (recherche dans le code) |
| Aucun secret dans une variable `VITE_*` (seules l’URL et la clé publique anon) | Vérifié |
| `.env.example` sans secret ; `.env*` exclus de Git | Vérifié |
| Photos (bucket public) séparées des documents (buckets privés) | Vérifié |
| Photos **toujours réencodées** avant envoi : métadonnées EXIF (dont GPS) supprimées ; envoi refusé si impossible | Vérifié (unitaire) |
| Documents privés et justificatifs : ouverts par téléchargement authentifié, sans lien réutilisable, envoyés sans cache navigateur ; consultation journalisée par l’interface | Code en place ; **à vérifier** sur Supabase |
| Formats et tailles limités (bucket + contrôle navigateur) | Vérifié (config SQL + unitaires) |
| Noms de fichiers de stockage aléatoires (jamais le nom d’origine) | Vérifié |
| PWA : seuls les fichiers statiques sont mis en cache, jamais l’API ni les pages ; pas de mise en cache d’une page HTML à la place d’un fichier | Revue de code (`public/sw.js`) |
| En-têtes HTTP de sécurité, `noindex` + `no-store` sur `/admin` | Fichier `_headers` ; **à vérifier** après déploiement |

## Journal d’activité et intégrité

- Journalisation **en base** (déclencheurs) des modifications des biens, propriétaires, prospects, mandats, visites,
  demandes, échanges, tâches, transactions, offres, finances, commissions, documents, **rôles et activations des
  comptes** et **paramètres de l’agence** (dont les règles de publication) : auteur, date, différences avant/après.
- Exports CSV, publications et consultations de documents journalisés explicitement ; un export n’est téléchargé
  qu’après sa journalisation. `log_event` n’accepte que ces actions (impossible d’y écrire des entrées arbitraires).
- Mots de passe, jetons et secrets jamais journalisés.
- Le journal n’est ni modifiable, ni supprimable, ni insérable via l’API, **même par l’administrateur** (vérifié).
- Montants en `numeric` exact ; encaissements immuables (corrections par ligne négative motivée) ; une recette
  encaissée ne peut pas être annulée sans correction préalable ; pas de suppression en cascade des dossiers historiques.

## Sauvegarde

Le script de sauvegarde conserve désormais les **droits d’accès** et le schéma `private` (défaut corrigé : une
restauration rendait `promote_to_admin` appelable par n’importe qui). Restauration testée (voir SAUVEGARDE.md).

## Données personnelles et conformité (à faire valider)

- Consentement recueilli et texte conservé avec chaque demande publique ; pour une demande saisie par l’équipe,
  l’accord n’est plus présumé : il doit être coché, et le nom de la personne qui l’a déclaré et la date sont enregistrés.
  Date de consentement des prospects tenue à jour automatiquement.
- **Anonymisation** (droit à l’effacement) par l’administrateur : nom, coordonnées, notes et textes libres effacés,
  références et montants conservés. Suppression des documents confidentiels et des échanges par l’administrateur.
- Exports limités aux colonnes autorisées ; colonnes sensibles refusées par le code.
- Textes de confidentialité et mentions légales **provisoires** : à valider selon la réglementation ivoirienne applicable.
- Durée de conservation paramétrable ; **pas de purge automatique** (anonymisation manuelle disponible).

## Points d’attention restants

1. Configurer Supabase Auth (inscriptions désactivées, Site URL, URL de redirection, SMTP) et relancer le Security Advisor.
2. Stockage : un membre de l’équipe commerciale peut télécharger un document privé par un appel direct à l’API Storage
   sans passer par l’interface (donc sans entrée de journal). Le verrouiller nécessite une Edge Function qui
   délivrerait les fichiers (évolution proposée).
3. Un fichier peut rester orphelin dans un bucket privé si son enregistrement échoue après l’envoi (sans exposition publique).
4. Tester le stockage réel (envoi, ouverture) et les aperçus de partage (Open Graph) après déploiement.
5. Double authentification (MFA) pour l’administrateur : non implémentée.
6. Faire relire les modèles de mandat et les textes juridiques par un professionnel compétent.
