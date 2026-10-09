# Coûts possibles et dépendances à des services tiers

Aucune dépense n’a été engagée. Les quotas et prix évoluent : **vérifiez-les sur les pages officielles au moment
du déploiement**. Ne souscrivez à aucune offre payante sans autorisation explicite du propriétaire.

## Services utilisés

| Service | Rôle | Offre gratuite (à vérifier) | Quand cela peut devenir payant |
|---|---|---|---|
| **Supabase** (https://supabase.com/pricing) | Base de données, authentification, stockage des fichiers | Projets gratuits avec quotas (taille de base, stockage, bande passante, utilisateurs actifs) | Dépassement des quotas ; sauvegardes automatiques téléchargeables / restauration à un instant donné ; éviter la mise en pause d’un projet inactif ; support |
| **Cloudflare Pages** (https://developers.cloudflare.com/pages/) | Hébergement du site et de la fonction sitemap | Offre gratuite généreuse (nombre de builds et de requêtes de fonctions limités) | Volume de builds ou de requêtes de fonctions élevé |
| **GitHub** (https://docs.github.com/) | Code source, historique | Dépôts privés gratuits | Fonctions avancées d’équipe |
| **Nom de domaine** | Adresse personnalisée (`.ci`, `.com`) | — | **Toujours payant** (achat annuel) — facultatif au départ (`*.pages.dev` gratuit) |
| **SMTP** (envoi de courriels) | Invitations, mot de passe oublié | Service intégré Supabase très limité | Service SMTP tiers pour un volume normal |
| **WhatsApp** | Lien `wa.me` | Gratuit (aucune API utilisée) | API WhatsApp Business (payante) si intégration au CRM souhaitée |

## Bibliothèques (gratuites, open source)

React, React Router, Vite, Tailwind CSS, Supabase JS, Zod, jsPDF / jspdf-autotable. Outils de test : Vitest,
Testing Library, Playwright. Aucune licence payante.

## Coûts indirects à prévoir

- Stockage supplémentaire si beaucoup de photos haute définition (les photos sont réduites à 1600 px avant envoi).
- Sauvegardes externes (disque chiffré ou stockage cloud).
- Relecture juridique des modèles (mandats, mentions légales, politique de confidentialité).
