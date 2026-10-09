# Guide d’utilisation (débutant)

L’application fonctionne dans le navigateur d’un téléphone Android, d’une tablette ou d’un ordinateur.
Sur Android (Chrome) : menu ⋮ → *Ajouter à l’écran d’accueil* pour l’ouvrir comme une application.

## Se connecter

1. Ouvrez `https://<votre-site>/connexion` (lien « Espace privé » en bas du site).
2. Saisissez votre adresse et votre mot de passe.
3. Mot de passe oublié : lien sous le formulaire ; un courriel vous permet d’en choisir un nouveau.

Si vous voyez « Accès non autorisé », l’administrateur doit encore vous attribuer un rôle.

## Le tableau de bord

Il résume l’activité : biens (disponibles, à vérifier, en négociation, vendus…), prospects, demandes non traitées,
visites à venir, tâches en retard et — pour l’administrateur et le comptable — les finances.
Choisissez la période en haut à droite. Cliquez une case pour ouvrir la liste correspondante.

> Le **montant des ventes** (prix des biens vendus) n’est pas le **chiffre d’affaires** de l’agence :
> seuls les encaissements réellement saisis comptent.

## Ajouter un bien et le publier

1. *Propriétaires → + Propriétaire* : nom, téléphone… puis *Créer*.
2. Sur la fiche du propriétaire : *+ Bien*. Remplissez titre, type, prix (en FCFA, sans décimales), ville, description.
   La référence (ex. `BIEN-2026-00012`) est créée automatiquement.
3. Sur la fiche du bien :
   - *+ Ajouter des photos* (galerie ou appareil photo). ★ choisit la photo principale, ← → changent l’ordre.
   - *Documents confidentiels* : titre foncier, ACD… (jamais visibles sur le site).
   - *+ Mandat* : choisissez le statut *Actif* et la date de signature quand le mandat est signé.
4. Après contrôle réel des documents : *Modifier* → *Statut de vérification : Vérifié*.
5. Le cadre *Publication sur le site* liste ce qui manque. Quand tout est rempli : *Publier l’annonce*.
   *Prévisualiser l’annonce* montre la page telle que les visiteurs la verront.
6. *Dépublier* retire l’annonce du site sans rien effacer.

## Traiter une demande

Les demandes du site arrivent dans *Demandes* (statut « Nouveau »). Les messages WhatsApp ou appels
ne sont **pas** importés automatiquement : enregistrez-les avec *+ Demande*.

Sur la fiche d’une demande : *Prendre en charge*, puis *Créer un prospect* (ou *Rattacher à…* si la personne
existe déjà), *Programmer une visite*, *Marquer traitée*, *Sans suite* ou *Indésirable*.

## Suivre un prospect

Fiche prospect : budget, zones, types de biens, consentements. Vous y trouvez les **biens correspondants**,
l’historique des échanges (*+ Échange* après chaque appel), les visites, et une alerte si un **doublon** est possible.
*+ Rappel* crée une tâche de relance.

## Visites

*Visites* affiche un calendrier par semaine (ou une liste). Après la visite : *Modifier* → statut *Effectuée*,
compte rendu, niveau d’intérêt (1 à 5), objections, prochaine action. Bouton *PDF* pour la fiche de visite.

## Négociation et vente

1. Fiche du bien → *+ Dossier* : choisissez l’acheteur et la règle de commission. Le bien passe « Sous négociation ».
2. *+ Offre* pour chaque offre ou contre-offre.
3. *Modifier / changer le statut* au fil des étapes. « Offre acceptée sous conditions » **n’est pas** une vente.
4. *Vente conclue* (prix convenu + date de conclusion obligatoires) : le bien est retiré du site, le mandat clôturé,
   et une **commission exigible** est créée dans les finances. Rien n’est effacé.
5. *Annulée / Abandonnée* demande un motif ; le bien redevient publié s’il n’y a pas d’autre dossier.

## Finances (administrateur, comptable)

- *Recettes* : montant **attendu**. Les **encaissements** se saisissent sur la fiche de la recette
  (*+ Encaissement*, avec justificatif). Le solde et le statut (partiel / encaissé) se calculent seuls.
- Une erreur ne s’efface pas : utilisez *Correction* (montant retiré + motif obligatoire).
- *Dépenses* : date, catégorie, montant, mode de paiement, bien ou transaction liés.
- *Règles de commission* : taux ou montant fixe **définis par l’agence** (pas des obligations légales).
- *Finances* : rapport par période + PDF (rapport financier, relevé des commissions).

## Tâches

*Tâches* : à faire, en retard (en rouge), échéances. Les rappels s’affichent dans l’application ;
aucun SMS ni courriel n’est envoyé.

## Documents, rapports et exports

- Chaque fiche a un bouton *PDF*. *Documents* génère inventaire, liste des tâches, relevés et **modèles de mandat**
  (à faire valider par un professionnel avant toute signature).
- *Rapports* : exports CSV par période (ouvrables dans Excel), rapport d’activité PDF, biens par zone.
  Chaque export est inscrit au journal.

## Administration (administrateur)

- *Paramètres* : nom, logo, coordonnées, numéro et message WhatsApp, zones, catégories, règles de publication,
  textes de confidentialité et mentions légales.
- *Utilisateurs* : attribuer un rôle et activer/désactiver un compte (les invitations se font dans Supabase).
- *Journal d’activité* : qui a modifié quoi et quand (lecture seule).

## Bonnes pratiques

- Ne saisissez pas de vraies données personnelles pendant les essais.
- Un bien n’est « vérifié » qu’après un contrôle réel : l’application ne remplace pas une vérification foncière.
- Déconnectez-vous sur un appareil partagé.
