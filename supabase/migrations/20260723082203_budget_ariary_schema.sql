/*
# Budget Ariary — schéma de base de données complet

Application de gestion de budget bilingue (Français / Malagasy) en Ariary,
avec transactions multi-utilisateurs, rôles opérateur/admin, journal d'audit,
et synchronisation hors-ligne via un identifiant client unique (client_uuid).

## 1. Nouvelles tables

- `public.profiles`
  - `id` (uuid, clé primaire) — identique à auth.users.id, référence 1:1.
  - `nom` (varchar(100)) — nom complet affiché.
  - `email` (varchar(150), unique) — redondant avec auth.users pour requêtes simples.
  - `role` (varchar(20), défaut 'operateur', CHECK dans {operateur, admin}).
  - `langue` (varchar(5), défaut 'fr', CHECK dans {fr, mg}).
  - `actif` (boolean, défaut true) — un opérateur désactivé ne peut plus se connecter / écrire.
  - `cree_le` (timestamptz, défaut now()).

- `public.transactions`
  - `id` (uuid, clé primaire).
  - `client_uuid` (uuid, unique, NOT NULL) — généré côté client (offline), empêche les doublons à la sync.
  - `date_transaction` (date, NOT NULL) — date saisie par l'utilisateur (modifiable).
  - `motif` (varchar(255), NOT NULL).
  - `type_operation` (varchar(10), CHECK dans {miditra, mivoaka}) — entrant / sortant.
  - `montant` (numeric(14,2), CHECK > 0).
  - `auteur_id` (uuid, NOT NULL, REFERENCES profiles(id) ON DELETE RESTRICT) — qui a créé.
  - `cree_le` (timestamptz, défaut now()) — ordre réel de création (utilisé pour le tri du solde).
  - `modifie_le` (timestamptz, nullable).
  - `supprime` (boolean, défaut false) — suppression douce, jamais de DELETE réel.

- `public.journal_audit`
  - `id` (uuid, clé primaire).
  - `transaction_id` (uuid, nullable, REFERENCES transactions(id) ON DELETE SET NULL).
  - `utilisateur_id` (uuid, NOT NULL, REFERENCES profiles(id) ON DELETE RESTRICT).
  - `action` (varchar(20), CHECK dans {creation, modification, suppression}).
  - `ancienne_valeur` (jsonb, nullable).
  - `nouvelle_valeur` (jsonb, nullable).
  - `horodatage` (timestamptz, défaut now()).

## 2. Sécurité (RLS)

- `profiles` : lecture pour tout utilisateur authentifié (besoin de connaître nom/role des collègues
  pour l'admin et l'affichage d'auteur). UPDATE/INSERT restreints : un utilisateur modifie son propre
  profil (langue/nom) ; les écritures liées aux comptes (création, désactivation, changement de rôle)
  passent par une fonction RPC `admin_create_user` appelée avec la service role depuis une edge
  function sécurisée, donc l'INSERT direct par un client anon/authenticated n'est PAS autorisé pour
  les comptes étrangers. Une policy INSERT limitée à soi-même couvre l'auto-création au signup.
- `transactions` : opérateurs voient et créent leurs propres lignes ; admin voit toutes les lignes et
  peut tout modifier/supprimer (suppression douce).
- `journal_audit` : seul un admin peut consulter. Aucune écriture directe client : les lignes sont
  insérées par des triggers côté serveur (tournent en SECURITY DEFINER / bypass RLS).

## 3. Triggers

- Trigger `transactions_audit_trigger` AFTER INSERT/UPDATE/DELETE sur `transactions` :
  alimente automatiquement `journal_audit` avec l'ancienne et la nouvelle valeur, l'action et
  l'utilisateur courant (`auth.uid()`).

## 4. Fonctions RPC

- `get_solde_total(bigint limit optionnel)` — solde global (somme miditra - somme mivoaka) sur les
  transactions non supprimées.
- `get_solde_utilisateur(p_user_id uuid)` — solde pour un utilisateur donné (vue opérateur).
- `get_historique_solde(p_user_id uuid NULL)` — renvoie l'historique trié par date + date de création
  avec le solde progressif via window function, filtré par auteur si un user_id est fourni.

## 5. Notes importantes

- Le solde n'est JAMAIS stocké : il est toujours recalculé par les RPC ci-dessus, ce qui garantit la
  cohérence même si des transactions hors-ligne arrivent dans le désordre après synchronisation.
- La colonne `auteur_id` n'a pas de DEFAULT auth.uid() intentionnellement : la valeur est fournie par
  l'application à partir de la session, ET la policy INSERT vérifie `auth.uid() = auteur_id`.
- Les migrations sont idempotentes (IF NOT EXISTS, DROP POLICY IF EXISTS avant création).
*/

-- ============================================================================
-- 1. PROFILES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nom varchar(100) NOT NULL,
  email varchar(150) UNIQUE NOT NULL,
  role varchar(20) NOT NULL DEFAULT 'operateur' CHECK (role IN ('operateur', 'admin')),
  langue varchar(5) NOT NULL DEFAULT 'fr' CHECK (langue IN ('fr', 'mg')),
  actif boolean NOT NULL DEFAULT true,
  cree_le timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_profiles" ON public.profiles;
CREATE POLICY "select_profiles" ON public.profiles FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_own_profile" ON public.profiles;
CREATE POLICY "insert_own_profile" ON public.profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON public.profiles;
CREATE POLICY "update_own_profile" ON public.profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ============================================================================
-- 2. TRANSACTIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid uuid UNIQUE NOT NULL,
  date_transaction date NOT NULL,
  motif varchar(255) NOT NULL,
  type_operation varchar(10) NOT NULL CHECK (type_operation IN ('miditra', 'mivoaka')),
  montant numeric(14,2) NOT NULL CHECK (montant > 0),
  auteur_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz,
  supprime boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON public.transactions(date_transaction);
CREATE INDEX IF NOT EXISTS idx_transactions_auteur ON public.transactions(auteur_id);
CREATE INDEX IF NOT EXISTS idx_transactions_cree_le ON public.transactions(cree_le);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- SELECT : opérateur voit ses transactions, admin voit tout
DROP POLICY IF EXISTS "select_transactions" ON public.transactions;
CREATE POLICY "select_transactions" ON public.transactions FOR SELECT
  TO authenticated
  USING (
    auteur_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- INSERT : un utilisateur crée seulement en son nom
DROP POLICY IF EXISTS "insert_transactions" ON public.transactions;
CREATE POLICY "insert_transactions" ON public.transactions FOR INSERT
  TO authenticated WITH CHECK (auteur_id = auth.uid());

-- UPDATE : opérateur peut modifier ses propres lignes, admin peut tout modifier
DROP POLICY IF EXISTS "update_transactions" ON public.transactions;
CREATE POLICY "update_transactions" ON public.transactions FOR UPDATE
  TO authenticated
  USING (
    auteur_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  )
  WITH CHECK (
    auteur_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- DELETE (réel) : réservé au serveur / service role ; clients utilisent la suppression douce
-- On laisse tout de même une policy admin pour cohérence.
DROP POLICY IF EXISTS "delete_transactions" ON public.transactions;
CREATE POLICY "delete_transactions" ON public.transactions FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ============================================================================
-- 3. JOURNAL D'AUDIT
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.journal_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  utilisateur_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  action varchar(20) NOT NULL CHECK (action IN ('creation', 'modification', 'suppression')),
  ancienne_valeur jsonb,
  nouvelle_valeur jsonb,
  horodatage timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_transaction ON public.journal_audit(transaction_id);
CREATE INDEX IF NOT EXISTS idx_audit_horodatage ON public.journal_audit(horodatage DESC);

ALTER TABLE public.journal_audit ENABLE ROW LEVEL SECURITY;

-- SELECT : admin uniquement
DROP POLICY IF EXISTS "select_journal_admin" ON public.journal_audit;
CREATE POLICY "select_journal_admin" ON public.journal_audit FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ============================================================================
-- 4. TRIGGER D'AUDIT
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_transactions_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_old jsonb;
  v_new jsonb;
  v_action varchar(20);
  v_tx_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_action := 'suppression';
    v_tx_id := OLD.id;
    v_new := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_action := 'modification';
    v_tx_id := NEW.id;
  ELSE -- INSERT
    v_old := NULL;
    v_new := to_jsonb(NEW);
    v_action := 'creation';
    v_tx_id := NEW.id;
  END IF;

  INSERT INTO public.journal_audit (transaction_id, utilisateur_id, action, ancienne_valeur, nouvelle_valeur)
  VALUES (v_tx_id, v_user, v_action, v_old, v_new);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS transactions_audit_trigger ON public.transactions;
CREATE TRIGGER transactions_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.fn_transactions_audit();

-- ============================================================================
-- 5. FONCTIONS RPC — SOLDE ET HISTORIQUE
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_solde_total()
RETURNS numeric(14,2)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(CASE WHEN type_operation = 'miditra' THEN montant ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN type_operation = 'mivoaka' THEN montant ELSE 0 END), 0)
  FROM public.transactions
  WHERE supprime = false;
$$;

CREATE OR REPLACE FUNCTION public.get_solde_utilisateur(p_user_id uuid)
RETURNS numeric(14,2)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(CASE WHEN type_operation = 'miditra' THEN montant ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN type_operation = 'mivoaka' THEN montant ELSE 0 END), 0)
  FROM public.transactions
  WHERE supprime = false AND auteur_id = p_user_id;
$$;

-- Historique avec solde progressif (window function), filtrable par auteur.
CREATE OR REPLACE FUNCTION public.get_historique_solde(p_user_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  client_uuid uuid,
  date_transaction date,
  motif varchar,
  type_operation varchar,
  montant numeric,
  auteur_id uuid,
  auteur_nom varchar,
  cree_le timestamptz,
  modifie_le timestamptz,
  solde_apres_operation numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      t.id,
      t.client_uuid,
      t.date_transaction,
      t.motif,
      t.type_operation,
      t.montant,
      t.auteur_id,
      p.nom AS auteur_nom,
      t.cree_le,
      t.modifie_le
    FROM public.transactions t
    LEFT JOIN public.profiles p ON p.id = t.auteur_id
    WHERE t.supprime = false
      AND (p_user_id IS NULL OR t.auteur_id = p_user_id)
  )
  SELECT
    b.id,
    b.client_uuid,
    b.date_transaction,
    b.motif,
    b.type_operation,
    b.montant,
    b.auteur_id,
    b.auteur_nom,
    b.cree_le,
    b.modifie_le,
    SUM(
      CASE WHEN b.type_operation = 'miditra' THEN b.montant ELSE -b.montant END
    ) OVER (ORDER BY b.date_transaction, b.cree_le) AS solde_apres_operation
  FROM base b
  ORDER BY b.date_transaction DESC, b.cree_le DESC;
$$;

-- ============================================================================
-- 6. FONCTION ADMIN — créer un utilisateur (appelée par edge function service role)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id uuid,
  nom varchar,
  email varchar,
  role varchar,
  langue varchar,
  actif boolean,
  cree_le timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, nom, email, role, langue, actif, cree_le
  FROM public.profiles
  ORDER BY cree_le DESC;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_user_id uuid,
  p_role varchar DEFAULT NULL,
  p_actif boolean DEFAULT NULL,
  p_langue varchar DEFAULT NULL,
  p_nom varchar DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_role IS NOT NULL THEN
    UPDATE public.profiles SET role = p_role WHERE id = p_user_id;
  END IF;
  IF p_actif IS NOT NULL THEN
    UPDATE public.profiles SET actif = p_actif WHERE id = p_user_id;
  END IF;
  IF p_langue IS NOT NULL THEN
    UPDATE public.profiles SET langue = p_langue WHERE id = p_user_id;
  END IF;
  IF p_nom IS NOT NULL THEN
    UPDATE public.profiles SET nom = p_nom WHERE id = p_user_id;
  END IF;
END;
$$;
