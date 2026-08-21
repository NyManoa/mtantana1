# Guide complet : application de gestion de budget en Ariary

Ce document contient deux choses :
1. **Le prompt complet** à donner à un outil d'IA de développement (Claude Code, Cursor, etc.) pour générer l'application.
2. **Un guide pas-à-pas sur la base de données** : comment la concevoir, la créer, et gérer la synchronisation hors-ligne.

---

## 1. Prompt complet pour générer l'application

Copie-colle ce prompt dans Claude Code (ou un outil similaire). Adapte les parties entre `[...]` si besoin.

```
Je veux créer une application web de gestion de budget personnel/associatif en Ariary (Ar, monnaie de Madagascar), bilingue français/malagasy.

### Fonctionnalités principales

1. Enregistrement de transactions avec les champs :
   - Date (par défaut = date du jour, modifiable)
   - Motif (texte libre)
   - Montant "Vola miditra" (argent entrant) OU "Vola mivoaka" (argent sortant) — un choix radio/toggle
   - Le solde restant est calculé automatiquement (jamais saisi à la main)

2. Un formulaire moderne et simple pour ajouter une transaction : date, motif, montant, type (entrant/sortant), bouton valider.

3. Historique des transactions sous forme de tableau (date, motif, entrant, sortant, solde après opération), trié du plus récent au plus ancien, avec recherche et filtre par date.

4. Deux rôles utilisateurs :
   - "Opérateur" : peut ajouter des transactions (crédit/débit), voir son historique.
   - "Administrateur" : voit toutes les transactions de tous les utilisateurs, peut modifier ou supprimer une transaction existante, gère les comptes utilisateurs (créer/désactiver un compte, changer un rôle).

5. Journal d'audit : chaque création, modification ou suppression de transaction est enregistrée avec qui l'a faite, quand, et l'ancienne/nouvelle valeur. L'admin a un espace dédié pour consulter ce journal.

6. Fonctionnement hors-ligne (offline-first) :
   - L'utilisateur peut ajouter des transactions sans connexion internet.
   - Les transactions sont stockées localement puis synchronisées automatiquement avec le serveur dès que la connexion revient.
   - Le solde final est toujours recalculé côté serveur pour éviter les incohérences en cas de transactions simultanées de plusieurs appareils.

7. Export des données vers un fichier Excel (.xlsx) reproduisant exactement les colonnes : Date, Motif, Vola miditra, Vola mivoaka, Solde. Bouton "Exporter" accessible à l'admin (et éventuellement à l'opérateur pour son propre historique).

8. Interface bilingue : un sélecteur de langue (Français / Malagasy) qui traduit tous les libellés de l'interface, y compris "Vola miditra" et "Vola mivoaka" qui restent dans tous les cas en malagasy comme demandé.

### Contraintes techniques souhaitées

- Frontend : React, avec une base de données locale IndexedDB (via Dexie.js) pour le mode hors-ligne.
- Backend : Node.js/Express avec PostgreSQL comme base de données centrale.
- Authentification simple par email/mot de passe avec gestion des rôles (opérateur/admin), sessions via JWT.
- API REST avec un endpoint de synchronisation qui accepte un lot de transactions créées hors-ligne et les insère en évitant les doublons (via un identifiant unique généré côté client).
- Le calcul du solde ne doit jamais être stocké de façon fixe pour chaque ligne sans recalcul : le solde affiché doit toujours pouvoir être reconstruit à partir de la somme des transactions triées par date/heure de création.
- Design moderne, sobre, adapté mobile et desktop.

### Livrables attendus

1. Le schéma de base de données (script SQL de création des tables).
2. Le backend avec les routes API (authentification, CRUD transactions, synchronisation, export Excel, journal d'audit).
3. Le frontend avec les pages : connexion, formulaire de transaction, historique, tableau de bord admin, journal d'audit, paramètres de langue.
4. Un fichier README expliquant comment lancer le projet en local (base de données, backend, frontend).

Commence par me proposer l'arborescence du projet et le schéma de base de données avant de générer le code, pour que je valide.
```

**Conseil d'utilisation** : ne donne pas tout ce prompt d'un coup à un débutant en programmation qui utiliserait un outil no-code — il est pensé pour un assistant de code capable de créer plusieurs fichiers (comme Claude Code). Si tu veux avancer par étapes, tu peux aussi demander d'abord uniquement "Étape 1 : le schéma de base de données et le backend d'authentification", puis avancer module par module.

---

## 2. Guide de base de données : comment faire, étape par étape

### 2.1 Choisir le bon outil

Pour ce type d'application, deux options réalistes :

| Option | Quand la choisir |
|---|---|
| **PostgreSQL** (recommandé) | Tu veux du multi-utilisateur solide, des rôles, des relations propres, une bonne base pour grandir. |
| **SQLite** | Tu veux tester vite en local, un seul utilisateur, ou une version très légère avant de migrer vers Postgres. |

Pour la partie hors-ligne côté client, on n'utilise **pas** Postgres/SQLite mais **IndexedDB** (via la librairie Dexie.js), qui est faite pour tourner dans le navigateur.

### 2.2 Le schéma de base de données (SQL)

Voici un script de création de base réaliste pour PostgreSQL :

```sql
-- Table des utilisateurs
CREATE TABLE utilisateurs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    mot_de_passe_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'operateur' CHECK (role IN ('operateur', 'admin')),
    langue VARCHAR(5) NOT NULL DEFAULT 'fr' CHECK (langue IN ('fr', 'mg')),
    actif BOOLEAN NOT NULL DEFAULT true,
    cree_le TIMESTAMP NOT NULL DEFAULT now()
);

-- Table des transactions
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_uuid UUID UNIQUE NOT NULL, -- généré côté client, évite les doublons de sync
    date_transaction DATE NOT NULL,
    motif VARCHAR(255) NOT NULL,
    type_operation VARCHAR(10) NOT NULL CHECK (type_operation IN ('miditra', 'mivoaka')),
    montant NUMERIC(14,2) NOT NULL CHECK (montant > 0),
    auteur_id UUID NOT NULL REFERENCES utilisateurs(id),
    cree_le TIMESTAMP NOT NULL DEFAULT now(),
    modifie_le TIMESTAMP,
    supprime BOOLEAN NOT NULL DEFAULT false -- suppression "douce", jamais de DELETE réel
);

-- Journal d'audit
CREATE TABLE journal_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID REFERENCES transactions(id),
    utilisateur_id UUID NOT NULL REFERENCES utilisateurs(id),
    action VARCHAR(20) NOT NULL CHECK (action IN ('creation', 'modification', 'suppression')),
    ancienne_valeur JSONB,
    nouvelle_valeur JSONB,
    horodatage TIMESTAMP NOT NULL DEFAULT now()
);

-- Index utiles pour les performances
CREATE INDEX idx_transactions_date ON transactions(date_transaction);
CREATE INDEX idx_transactions_auteur ON transactions(auteur_id);
CREATE INDEX idx_audit_transaction ON journal_audit(transaction_id);
```

**Points importants à comprendre :**

- **`client_uuid`** : c'est la clé qui rend la synchronisation hors-ligne sûre. Quand le téléphone crée une transaction sans internet, il génère cet identifiant unique localement. Au moment de la sync, le serveur vérifie s'il existe déjà — s'il existe, il ignore (pas de doublon).
- **`supprime` (suppression douce)** : on ne supprime jamais réellement une ligne. On la marque comme supprimée. Ça permet à l'admin de voir l'historique complet dans le journal d'audit, même après une "suppression".
- **Pas de colonne "solde"** dans la table transactions : le solde n'est **jamais stocké**, il est **calculé** à chaque fois avec une requête (voir 2.3). C'est ce qui garantit que le solde reste juste même si des transactions arrivent dans le désordre après une synchronisation.

### 2.3 Calculer le solde (au lieu de le stocker)

```sql
-- Solde total actuel
SELECT
    COALESCE(SUM(CASE WHEN type_operation = 'miditra' THEN montant ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN type_operation = 'mivoaka' THEN montant ELSE 0 END), 0)
    AS solde_actuel
FROM transactions
WHERE supprime = false;

-- Solde progressif ligne par ligne (pour l'affichage du tableau, comme sur Excel)
SELECT
    date_transaction,
    motif,
    type_operation,
    montant,
    SUM(
        CASE WHEN type_operation = 'miditra' THEN montant ELSE -montant END
    ) OVER (ORDER BY date_transaction, cree_le) AS solde_apres_operation
FROM transactions
WHERE supprime = false
ORDER BY date_transaction, cree_le;
```

La clause `OVER (ORDER BY ...)` est une "fenêtre de calcul" (window function) : elle recrée exactement la logique Excel ("le solde de la ligne = solde précédent + entrant - sortant"), mais calculée automatiquement par la base de données, sans jamais risquer une erreur de recopie de formule.

### 2.4 Étapes pratiques pour monter la base

1. **Installer PostgreSQL** (localement via un installeur, ou via un service cloud comme Supabase, Neon, ou Railway — pratique pour débuter sans gérer un serveur).
2. **Créer la base** : `CREATE DATABASE budget_ariary;`
3. **Exécuter le script SQL** ci-dessus dans un outil comme pgAdmin, DBeaver, ou en ligne de commande (`psql -d budget_ariary -f schema.sql`).
4. **Utiliser un ORM côté backend** (par exemple Prisma ou Sequelize pour Node.js) : ça te permet d'écrire des requêtes en JavaScript plutôt qu'en SQL brut, et de gérer facilement les migrations quand tu changeras le schéma plus tard.
5. **Gérer les migrations** : dès que tu modifies une table (ajouter une colonne, etc.), utilise un outil de migration (Prisma Migrate, Sequelize CLI, ou Flyway) plutôt que de modifier la base à la main — ça garde un historique propre et reproductible.

### 2.5 Côté client (hors-ligne)

- Utilise **Dexie.js** pour créer une base IndexedDB locale avec une table `transactions_locales` ayant la même structure que côté serveur (avec le `client_uuid`).
- Ajoute un champ `statut_sync` (`en_attente` / `synchronise`) sur chaque transaction locale.
- Quand la connexion revient (tu peux détecter ça avec l'événement `window.addEventListener('online', ...)`), envoie toutes les transactions `en_attente` vers l'endpoint `/api/sync` du serveur en une seule requête groupée.
- Une fois confirmées par le serveur, marque-les `synchronise` et remplace le solde affiché localement par celui renvoyé par le serveur.

---

Si tu veux, je peux aussi te préparer le code réel du backend (routes API) ou le script de migration prêt à copier dans un fichier `.sql`.
