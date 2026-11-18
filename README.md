# M'tantana — gestion de budget en Ariary

Application web (PWA) bilingue français / malagasy pour suivre les entrées
(« Vola miditra ») et sorties (« Vola mivoaka ») d'argent, seul ou en équipe.

## Trois façons de stocker les données

| Mode | Où sont les données | Connexion requise |
|---|---|---|
| **Sans compte** | Sur l'appareil uniquement (IndexedDB) | Jamais |
| **Sans compte + Google Drive** | Sur l'appareil + copie privée dans le Google Drive de l'utilisateur | Seulement pour sauvegarder / restaurer |
| **Compte en ligne** (Supabase) | Sur l'appareil + synchronisé avec le cloud, partageable en équipe | Non : on peut saisir hors ligne, la synchro se fait au retour du réseau |

- Chaque compte a sa **propre base locale** sur l'appareil : deux personnes
  sur le même ordinateur ne voient jamais les données de l'autre.
- Les données saisies sans compte peuvent être importées plus tard dans un
  espace en ligne (Paramètres → Stockage).
- La sauvegarde Google Drive utilise la portée `drive.appdata` : l'application
  n'a accès qu'à son propre dossier caché, jamais aux autres fichiers.

## Rôles (par espace)

Les droits dépendent du rôle **dans l'espace courant** : une même personne peut
être admin de son espace et opératrice dans celui d'une association.

| | Opérateur | Superviseur (saisie + consultation) | Admin |
|---|:-:|:-:|:-:|
| Saisir des entrées / sorties | ✔ | ✔ | ✔ |
| Modifier / supprimer ses propres saisies | ✔ | ✔ | ✔ |
| Voir toutes les transactions, tableau de bord, budgets, alertes | | ✔ (lecture seule) | ✔ |
| Modifier les saisies des autres, valider, budgets, alertes, import, journal d'audit, membres | | | ✔ |

Ces règles sont appliquées **par la base de données** (policies RLS), pas
seulement par l'interface.

## Ordres, validations et notifications

Exemple : vous êtes **admin** avec la fonction « Commissaire aux comptes », le
trésorier est **superviseur** avec la fonction « Trésorier » (Membres → modifier
→ *Fonction*). Les droits viennent du rôle ; la fonction est un titre affiché.

1. **Ordre** — Ordres → *Nouvel ordre* : débit ou crédit, montant, date,
   exécutant (le trésorier, ou « tout superviseur / admin »).
2. **Notification** — tous les membres connectés de l'espace sont avertis en
   temps réel (cloche, message, et notification système si activée sur
   l'appareil). Rappel automatique à l'approche de la date.
3. **Exécution** — le trésorier clique *Exécuter le débit* : la transaction est
   créée avec **le montant fixé par l'admin** (non modifiable) et elle est
   **validée d'office au nom de l'admin**. Il peut aussi *Refuser* (motif
   obligatoire) ; l'admin peut *Annuler* ou *Rouvrir*.
4. **Saisie libre** — le trésorier peut toujours saisir au formulaire. Avec
   Paramètres → *Toutes les saisies doivent être validées*, chaque saisie d'un
   non-admin reste « en attente » ; l'admin la **valide** ou la **refuse**
   (motif obligatoire, notifié à l'auteur) depuis Ordres → *À faire*.

**Traçabilité** : Ordres → *Activité* montre qui a émis, exécuté, refusé,
validé, modifié ou supprimé quoi, et quand. En ligne, cet historique est écrit
**par la base de données** (triggers) : personne ne peut le modifier, pas même
un admin. Chaque transaction indique aussi qui l'a validée et si elle provient
d'un ordre ; le journal d'audit (admin) garde le détail avant / après.

Ces règles sont vérifiées par le serveur : un exécutant ne peut pas changer le
montant d'un ordre, exécuter un ordre qui ne lui est pas destiné, ni l'exécuter
deux fois.

## Inviter quelqu'un dans un espace

Membres → **Inviter** → adresse e-mail + rôle.

- La personne a déjà un compte : elle est ajoutée tout de suite.
- Sinon : l'invitation reste « en attente ». Copiez le lien d'invitation et
  envoyez-le (e-mail, SMS, WhatsApp). Dès que la personne se connecte avec
  **cette adresse** (« Continuer avec Google » ou création de compte confirmée),
  l'espace apparaît chez elle.
- Une invitation n'est acceptée que pour une adresse **vérifiée** : personne ne
  peut la récupérer en s'inscrivant avec l'adresse d'un autre.

## Démarrage local

```bash
cp .env.example .env    # puis renseigner les valeurs
npm install
npm run dev
```

Vérifications : `npm run typecheck`, `npm run lint`, `npm run build`.

## Mise en production — à faire une fois

### 1. Base de données

Appliquer les migrations, dont `20261118120000_security_hardening.sql`
(corrections de sécurité critiques) et `20261118130000_invitations_keepalive.sql`
(invitations, anti-pause) :

**Sans installer d'outil (recommandé)** : Supabase → *SQL Editor* → *New query* →
coller tout le fichier, puis *Run*, **dans cet ordre** :

1. `supabase/sql-editor/appliquer-mises-a-jour-2026-11-18.sql` (sécurité, invitations, anti-pause)
2. `supabase/sql-editor/appliquer-ordres-notifications-2026-11-19.sql` (ordres, fonctions, notifications)

Chaque fichier passe dans une seule transaction : en cas d'erreur, rien n'est
modifié. Les rejouer est sans risque.

Avec la CLI (`npx supabase@latest …`) :

```bash
npx supabase@latest login
npx supabase@latest link --project-ref <votre-ref>
npx supabase@latest db push
```

### 2. Edge functions

Dashboard → *Edge Functions* → `admin-users` → coller le contenu de
`supabase/functions/admin-users/index.ts` → *Deploy* ; supprimer `confirm-email`.
Ou avec la CLI :

```bash
npx supabase@latest functions deploy admin-users --project-ref <votre-ref>
# Supprimer l'ancienne fonction, qui permettait à n'importe qui de confirmer n'importe quel e-mail :
npx supabase@latest functions delete confirm-email --project-ref <votre-ref>
# Optionnel : limiter les origines autorisées
npx supabase@latest secrets set ALLOWED_ORIGINS=https://votre-domaine.mg
```

### 3. Réglages Supabase (Dashboard → Authentication)

- **Email → Confirm email** : activé.
- **Passwords → Minimum length** : 8 (l'application l'impose aussi).
- **URL Configuration** : *Site URL* = votre domaine ; ajouter
  `https://votre-domaine/reset-password` dans *Redirect URLs*.
- **Rate limits** : laisser les valeurs par défaut (protection contre le
  bourrage d'identifiants).

### 4. Google (optionnel)

**Sauvegarde Google Drive**
1. Google Cloud Console → *APIs & Services* → activer **Google Drive API**.
2. *Credentials* → *OAuth client ID* → type **Web application** ;
   *Authorized JavaScript origins* : votre domaine (et `http://localhost:5173` en dev).
3. Écran de consentement : ajouter la portée `.../auth/drive.appdata`.
4. Mettre l'identifiant dans `VITE_GOOGLE_CLIENT_ID`.

**Connexion « Continuer avec Google »**
1. Supabase → *Authentication → Providers → Google* : activer et coller le
   client ID / secret (client OAuth distinct, avec l'URL de callback Supabase).
2. `VITE_ENABLE_GOOGLE_LOGIN=true`.

### 5. Éviter la mise en pause (projet gratuit)

Un projet Supabase gratuit est mis en pause après ~7 jours sans activité.
Le workflow `.github/workflows/supabase-keepalive.yml` appelle la base tous
les 3 jours :

1. GitHub → dépôt → *Settings → Secrets and variables → Actions* → ajouter
   `SUPABASE_URL` et `SUPABASE_ANON_KEY` (clé **anon**, jamais `service_role`).
2. Pousser le dépôt sur GitHub, puis *Actions → Supabase keep-alive → Run workflow*
   pour tester.

Limites : GitHub désactive les tâches planifiées d'un dépôt **public** sans
commit depuis 60 jours (un e-mail prévient ; il suffit de les réactiver).
Seule l'offre payante Supabase garantit l'absence de pause.

Même en pause, l'application reste utilisable : les données de l'appareil
s'affichent et la synchronisation reprend quand le serveur répond.

### 6. Hébergement

`public/_headers` et `public/_redirects` sont prêts pour Netlify / Cloudflare
Pages (en-têtes de sécurité + routage SPA). Le build injecte une
Content-Security-Policy qui n'autorise que Supabase et Google.

## Sécurité — ce qui est en place

- RLS sur toutes les tables, basée sur l'appartenance et le rôle dans l'espace.
- Le client ne peut modifier que `nom` et `langue` de son profil (privilèges par colonne).
- Appartenances aux espaces modifiables uniquement via `create_espace()` et l'edge function `admin-users`.
- Auteur, espace et identifiant d'une transaction immuables ; seul un admin valide.
- Journal d'audit écrit uniquement par trigger (non falsifiable).
- Aucun mot de passe stocké sur l'appareil ; PKCE pour les liens e-mail et OAuth.
- Données locales purgées quand l'accès à un espace est retiré.

## Point restant connu

`xlsx` 0.18.5 (npm) a des vulnérabilités connues. SheetJS ne publie plus sur
npm ; installer la version corrigée depuis leur CDN officiel :

```bash
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```
