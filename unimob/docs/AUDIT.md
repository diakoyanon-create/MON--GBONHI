# Rapport d'audit (10-11 octobre 2026)

Audit réalisé par 6 auditeurs indépendants (conformité, sécurité, compatibilité Supabase, interface, logique métier, site public), chaque constat étant ensuite soumis à un vérificateur chargé de le **réfuter** avec des preuves exécutées (requêtes SQL sous le rôle concerné, compilation, lecture de la documentation officielle).

Résultat : **76 constats confirmés**, 1 réfuté, 0 incertain. Plusieurs constats se recoupent entre dimensions.

Les corrections sont dans `supabase/migrations/20261010000700_corrections_audit.sql` (base) et dans l'interface ; elles sont couvertes par `tests/db/corrections.test.ts`, `tests/db/grants-stricts.test.ts`, `tests/unit/corrections.test.ts` et les tests de bout en bout.

## Constats les plus importants

1. **Projets Supabase récents** : sans privilèges explicites, tout l'espace privé aurait renvoyé « permission denied ». Corrigé et testé dans un mode « sans privilèges par défaut » (base et bout en bout).
2. **Vue `public_agency_info` modifiable par un visiteur** (téléphone/WhatsApp de l'agence détournables). Corrigé : toutes les vues en lecture seule.
3. **Mandat expiré** permettant de publier, annonces restant en ligne une fois non conformes. Corrigé : contrôle permanent dans la vue publique + maintenance quotidienne.
4. **Ventes** : réouverture incohérente, commission à 0 FCFA, dossiers multiples comptés deux fois. Corrigé.
5. **Sauvegarde** sans les droits d'accès (et, découvert pendant la correction, sans le schéma `private`). Corrigé et vérifié par restauration.

## Liste complète

| Dimension | Gravité | Constat | Statut |
|---|---|---|---|
| Conformité au cahier des charges | Haute | Un mandat expiré reste « Actif » et permet toujours de publier | Corrigé |
| Conformité au cahier des charges | Moyenne | Procédures d’archivage et de suppression (§9) impossibles pour propriétaires, prospects convertis et documents | Corrigé |
| Conformité au cahier des charges | Moyenne | Changements de permissions et de règles de publication absents du journal (et journal falsifiable via log_event) | Corrigé |
| Conformité au cahier des charges | Moyenne | Consentement présumé « Oui » pour les demandes saisies par l’équipe, puis propagé au prospect sans preuve | Corrigé |
| Conformité au cahier des charges | Moyenne | Rappels des mandats (reminder_date) et relances de visites (follow_up_at) jamais affichés | Corrigé |
| Conformité au cahier des charges | Moyenne | Justificatif de dépense et document de mandat signé impossibles à joindre | Corrigé pour les dépenses (justificatif) et les mandats (document signé) ; les justificatifs de transaction restent une note texte + documents du bien. |
| Conformité au cahier des charges | Moyenne | Filtres manquants : biens par prix, prospects par budget et par localisation | Corrigé |
| Conformité au cahier des charges | Moyenne | Modifier un bien vendu efface son motif d’indisponibilité | Corrigé |
| Conformité au cahier des charges | Moyenne | Métadonnées Open Graph et descriptions injectées seulement en JavaScript : absentes pour les robots et aperçus WhatsApp | Corrigé : Pages Function /biens/:reference qui injecte les balises (injection testée en unitaire ; la fonction Cloudflare elle-même ne peut être exécutée qu'après déploiement). |
| Conformité au cahier des charges | Basse | Rapports §5.12 incomplets ou mal filtrés (commissions, inventaire, biens par zone, offres) | Corrigé en grande partie : inventaire et commissions en « état actuel », offres exportables, biens par zone exportables ; pas de filtre supplémentaire par statut/type dans les exports. |
| Conformité au cahier des charges | Basse | Rattachement d’une demande limité aux doublons détectés automatiquement | Corrigé |
| Conformité au cahier des charges | Basse | Paramètres « devise », « fuseau horaire » et « catégories de biens » non modifiables (colonnes mortes) | Documenté : la devise XOF et le fuseau Africa/Abidjan sont fixes en version 1 (limite indiquée dans FONCTIONNALITES.md). |
| Conformité au cahier des charges | Basse | Section « Finances (période sélectionnée) » du tableau de bord : trois indicateurs ignorent la période | Corrigé |
| Conformité au cahier des charges | Basse | Accueil : « biens récents » et « biens mis en avant » fusionnés ; les récents disparaissent dès 6 biens mis en avant | Corrigé |
| Sécurité | Haute | La vue public_agency_info est modifiable et supprimable par anon : détournement des contacts de l'agence et neutralisation des règles de publication | Corrigé |
| Sécurité | Haute | Une référence saisie par le client bloque définitivement le compteur : création impossible, formulaire public compris | Corrigé |
| Sécurité | Moyenne | La limite de débit de submit_inquiry se contourne en envoyant les requêtes en parallèle | Corrigé |
| Sécurité | Moyenne | Les règles de publication ne sont vérifiées qu'au passage au statut public : un bien publié reste en ligne même devenu non conforme | Corrigé |
| Sécurité | Moyenne | Un bien vendu ou archivé peut être republié en deux étapes | Corrigé |
| Sécurité | Moyenne | created_by est modifiable par le client : n'importe quel membre de l'équipe peut supprimer toute tâche et attribuer des échanges à un collègue | Corrigé |
| Sécurité | Moyenne | Chacun peut modifier l'email et le nom de son propre profil : usurpation dans la page Utilisateurs et dans le journal | Corrigé |
| Sécurité | Basse | Un agent peut réécrire les montants d'une vente conclue sans la rouvrir ; la recette n'est pas mise à jour | Corrigé |
| Sécurité | Basse | status_history est lisible par toute l'équipe : statuts d'encaissement visibles par agents et assistants, suivi des prospects visible par le comptable | Corrigé |
| Sécurité | Basse | Les changements de rôle et d'activation ne sont pas journalisés en base | Corrigé |
| Sécurité | Basse | client_fingerprint est un SHA-256 de l'IP sans sel, lisible via l'API par toute l'équipe commerciale | Corrigé |
| Sécurité | Basse | Certaines photos sont envoyées telles quelles dans le bucket public, métadonnées EXIF (GPS) comprises | Corrigé |
| Sécurité | Basse | La durée de 5 minutes des liens signés et la journalisation des consultations ne sont appliquées que côté client | Partiel : les documents s'ouvrent désormais par téléchargement authentifié (aucun lien réutilisable, consultation journalisée par l'interface). Un appel direct à l'API Storage par un membre commercial reste possible sans trace ; le verrouiller exige une Edge Function (limite documentée). |
| Compatibilité Supabase | Haute | Les migrations s'appuient sur des GRANT implicites que Supabase n'accorde plus aux nouveaux projets : tout l'espace privé renvoie 42501 | Corrigé |
| Compatibilité Supabase | Haute | La sauvegarde (--no-privileges) puis la restauration documentée perdent tous les REVOKE et GRANT : promote_to_admin devient appelable par tout utilisateur, ou le site tombe en 42501 | Corrigé |
| Compatibilité Supabase | Moyenne | Le lien d'invitation Supabase ouvre la page d'accueil avec une session : aucune étape ne permet de choisir son mot de passe | Corrigé |
| Compatibilité Supabase | Moyenne | Exports CSV, statistiques par zone et sitemap demandent 2 000 à 10 000 lignes alors que Supabase plafonne à 1 000 (Max rows) sans erreur | Corrigé |
| Compatibilité Supabase | Basse | Catalogue et listes : count=exact avec un offset au-delà du total renvoie l'erreur PostgREST 416 (PGRST103) au lieu d'une page vide | Corrigé |
| Compatibilité Supabase | Basse | Le nettoyage du fichier après un échec d'insertion échoue en silence (DELETE réservé à l'admin) : des documents confidentiels restent orphelins | Partiel : longueur de l'intitulé bornée pour éviter l'échec ; un fichier peut encore rester orphelin si l'enregistrement échoue après l'envoi (limite documentée, sans exposition publique : bucket privé). |
| Interface | Haute | Un échec réseau au rechargement du profil démonte tout l'espace privé (« compte non activé ») et fait perdre la saisie en cours | Corrigé |
| Interface | Moyenne | Montants saisis avec « . » ou « , » comme séparateur de milliers divisés par 1000 sans aucune erreur | Corrigé |
| Interface | Moyenne | Exports CSV, inventaire PDF et « Biens par zone » tronqués sans avertissement à 1000 lignes (max_rows Supabase) | Corrigé |
| Interface | Moyenne | PDF : les caractères « → » et « − » (hors WinAnsi) rendent la ligne entière illisible | Corrigé |
| Interface | Moyenne | Aucune ErrorBoundary : si le chunk AdminRoutes ne se charge pas après un redéploiement, l'écran devient blanc | Corrigé |
| Interface | Basse | PDF : pied de page et titres écrits sans retour à la ligne, l'avertissement juridique du modèle de mandat est coupé | Corrigé |
| Interface | Basse | Numéro de page hors limites dans l'URL : erreur PostgREST 416 en anglais et liste bloquée | Corrigé |
| Interface | Basse | Tableau de bord : les tuiles mènent à une liste filtrée qui ne correspond pas au nombre affiché | Corrigé |
| Interface | Basse | Champs relation : la valeur enregistrée s'affiche « — Choisir — » ou « — Aucun — » quand l'élément lié est archivé, inactif ou au-delà de 500 lignes | Corrigé |
| Interface | Basse | Bouton « Supprimer » proposé à l'administrateur sur les recettes alors que la base l'interdit toujours | Corrigé |
| Interface | Basse | Variable Supabase vide ou URL sans https : exception à l'import et page blanche au lieu de l'écran « Configuration requise » | Corrigé |
| Interface | Basse | Site public : un échec réseau au premier chargement fige les infos de repli (faux nom d'agence, pas de WhatsApp) pour toute la session | Corrigé |
| Interface | Basse | Fiche prospect : « Dernier contact » n'est pas rafraîchi après l'ajout d'un échange | Corrigé |
| Logique métier et finances | Haute | Un mandat échu, non commencé ou signé dans le futur reste « actif » et permet la publication | Corrigé |
| Logique métier et finances | Haute | Les conditions de publication ne sont contrôlées qu'à l'entrée en ligne ; l'abandon d'un dossier republie sans contrôle | Corrigé |
| Logique métier et finances | Haute | Rouvrir puis annuler une vente conclue laisse le bien « vendu », le mandat clôturé et la commission exigible | Corrigé |
| Logique métier et finances | Haute | Vente conclue sans commission convenue : écriture à 0 FCFA, la commission disparaît de tous les indicateurs | Corrigé |
| Logique métier et finances | Haute | Une référence manuelle au format automatique bloque toute création suivante (compteur annulé avec l'échec) | Corrigé |
| Logique métier et finances | Moyenne | Une écriture de commission saisie avant la conclusion (prévue ou annulée) empêche la commission de devenir exigible | Corrigé |
| Logique métier et finances | Moyenne | Plusieurs dossiers ouverts sur un même bien : commission estimée comptée plusieurs fois, dossiers orphelins après la vente | Corrigé |
| Logique métier et finances | Moyenne | Une recette encaissée peut être annulée : l'argent reste compté en encaissé, ne peut plus être remboursé et le statut devient faux | Corrigé |
| Logique métier et finances | Moyenne | Modifier le montant attendu ne recalcule pas le statut : recette « encaissée » avec un solde dû, invisible dans les commissions dues | Corrigé |
| Logique métier et finances | Moyenne | Un agent peut remettre en vente un bien vendu en deux étapes et réécrire un dossier conclu | Corrigé |
| Logique métier et finances | Moyenne | Changer le propriétaire d'un bien garde actif le mandat de l'ancien propriétaire et bloque les dossiers et mandats liés | Corrigé |
| Logique métier et finances | Moyenne | property_matches compare les superficies sans tenir compte de l'unité (m², ha, lot) | Corrigé |
| Logique métier et finances | Moyenne | Rapport financier : « encaissé » calculé sur deux bases de dates différentes ; commission auto datée du jour de saisie | Corrigé |
| Logique métier et finances | Basse | Un bien passé « réservé » pendant un dossier reste réservé et en ligne après l'abandon de ce dossier | Corrigé |
| Logique métier et finances | Basse | Tableau de bord : tuiles « période sélectionnée » qui ignorent la période, compteurs différents des listes liées | Corrigé |
| Site public, mobile, accessibilité | Moyenne | Open Graph, titre et description injectés seulement en JavaScript : les aperçus WhatsApp et Facebook des annonces sont génériques et sans photo | Corrigé : voir conformite-open-graph-client (à vérifier après déploiement avec l'outil de débogage de partage Facebook/WhatsApp). |
| Site public, mobile, accessibilité | Moyenne | Documents confidentiels et justificatifs envoyés avec Cache-Control max-age=3600 : le navigateur les garde en cache 1 h, au-delà du lien signé de 5 min | Corrigé |
| Site public, mobile, accessibilité | Moyenne | Photos publiques publiées avec leurs métadonnées EXIF (GPS) quand compressImage renvoie le fichier d'origine | Corrigé |
| Site public, mobile, accessibilité | Moyenne | Formulaire de demande : erreurs de validation non annoncées, sans focus ni défilement vers le premier champ en erreur (invisibles sur mobile) | Corrigé |
| Site public, mobile, accessibilité | Moyenne | La saisie du formulaire de demande est perdue en suivant le lien « En savoir plus » du formulaire ou en rechargeant la page | Corrigé |
| Site public, mobile, accessibilité | Basse | Focus clavier invisible sur les boutons radio « préférence de contact » et sur l'ajout de photos ; anneau de focus des champs à 1,65:1 | Corrigé |
| Site public, mobile, accessibilité | Basse | robots.txt : directive Sitemap relative (/sitemap.xml), invalide et ignorée par les moteurs | Corrigé |
| Site public, mobile, accessibilité | Basse | Contrastes insuffisants sur le site public : référence des cartes (2,06:1), placeholder servant d'unique libellé (2,06:1), boutons WhatsApp (4,12:1) | Corrigé |
| Site public, mobile, accessibilité | Basse | Navigation SPA sans remise en haut de page ni déplacement du focus : la nouvelle page s'ouvre au milieu | Corrigé |
| Site public, mobile, accessibilité | Basse | Bien fictif : badge « Disponible » à côté de « non disponible » et formulaire de demande actif pour un bien inexistant | Corrigé |
| Site public, mobile, accessibilité | Basse | Après un déploiement, « Espace privé » donne un écran blanc définitif (chunk disparu servi en HTML puis mis en cache par le service worker, aucune ErrorBoundary) | Corrigé |
| Site public, mobile, accessibilité | Basse | Catalogue : changer le tri ne trie pas, il faut aussi toucher « Filtrer » | Corrigé |
| Site public, mobile, accessibilité | Basse | Lien de pagination périmé ou ?page invalide : « Le catalogue est momentanément indisponible » au lieu d'une liste | Corrigé |
| Site public, mobile, accessibilité | Basse | Recherche publique sensible aux accents : « adjame » ou « angre » ne trouvent pas « Adjamé » ou « Angré » | Corrigé |
| Site public, mobile, accessibilité | Basse | Titres et descriptions des pages : nom de l'agence jamais ajouté, pluriel fautif (« Local commercials »), prix « — » dans la description | Corrigé |

## Constat réfuté

- Statut « Vérifié » attribuable sans aucun contrôle documentaire, ce qui débloque la publication — réfuté : statut de vérification déclaratif, non exposé au public, procédure documentée.

