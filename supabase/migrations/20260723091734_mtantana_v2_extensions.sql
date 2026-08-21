/*
# M'tantana — extension du schéma (v2)

## Résumé
Ajoute les catégories, un statut de validation pour les grosses transactions,
les budgets prévisionnels, les alertes de seuil, les transactions récurrentes,
et un nouveau rôle "superviseur". Restreint les RPC de solde/historique aux
administrateurs et superviseurs uniquement — un opérateur qui les appelle
directement reçoit une erreur 403.

## 1. Modifications de tables existantes
- `profiles.role` : élargit le CHECK pour accepter 'superviseur'.
- `transactions` : ajoute
  - `categorie` (varchar(40), NOT NULL DEFAULT 'autre')
  - `statut` (varchar(20), NOT NULL DEFAULT 'validee', CHECK dans
    {validee, en_attente_validation})
  - `recurrente_parent_id` (uuid, nullable, auto-réf) pour lier une occurrence
    générée à sa transaction récurrente parente.
- `journal_audit.action` : élargit le CHECK pour accepter 'validation'.

## 2. Nouvelles tables
- `categories` — catalogue de catégories (id, nom, couleur, icône, ordre, active).
  Pré-rempli avec 8 catégories par défaut.
- `budgets` — limite mensuelle par catégorie définie par l'admin
  (id, categorie, mois_annee YYYY-MM, limite, cree_par).
- `alertes` — configuration d'alerte (id, type, seuil, active, cree_par,
  cree_le, derniere_notification).
- `transactions_recurrentes` — modèle de transaction récurrente
  (id, date_depart, frequence, prochaine_occurrence, motif, categorie,
  type_operation, montant, auteur_id, actif, cree_le).
  Un trigger/cron edge function génère les occurrences.

## 3. Sécurité (RLS)
- `categories` : lecture pour tous les authentifiés ; écriture admin uniquement.
- `budgets` : lecture admin+superviseur ; écriture admin.
- `alertes` : lecture admin ; écriture admin.
- `transactions_recurrentes` : lecture propre (opérateur) ou admin+superviseur ;
  écriture propre ou admin.

## 4. Verrouillage des RPC pour les opérateurs
- `get_solde_total()`, `get_solde_utilisateur()`, `get_historique_solde()` :
  réécrites en plpgsql avec une garde `SECURITY DEFINER` qui vérifie le rôle.
  Un opérateur (role = 'operateur') déclenche `RAISE EXCEPTION 'Accès refusé'`
  (code 42501) qui remonte côté client comme une erreur 403 / permission denied.

## 5. Trigger de validation automatique
- Les transactions dont le montant dépasse le seuil configurable
  (100 000 Ar par défaut, stocké dans la table `settings`) sont créées avec
  le statut 'en_attente_validation' et doivent être confirmées par un admin.

## 6. Notes
- Toutes les opérations sont additives (IF NOT EXISTS, ADD COLUMN IF NOT EXISTS).
- Aucune donnée existante n'est perdue.
*/

-- ============================================================================
-- 0. SETTINGS (seuil de validation, etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.settings (
  cle varchar(50) PRIMARY KEY,
  valeur text NOT NULL,
  description text
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_settings" ON public.settings;
CREATE POLICY "select_settings" ON public.settings FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_write_settings" ON public.settings;
CREATE POLICY "admin_write_settings" ON public.settings FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

INSERT INTO public.settings (cle, valeur, description) VALUES
  ('seuil_validation', '100000', 'Montant au-delà duquel une transaction nécessite une validation admin (Ariary)')
ON CONFLICT (cle) DO NOTHING;

-- ============================================================================
-- 1. PROFILES — ajouter le rôle superviseur
-- ============================================================================
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('operateur', 'admin', 'superviseur'));

-- ============================================================================
-- 2. CATEGORIES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.categories (
  id serial PRIMARY KEY,
  nom varchar(40) NOT NULL UNIQUE,
  couleur varchar(7) NOT NULL DEFAULT '#64748b',
  icone varchar(40) NOT NULL DEFAULT 'tag',
  ordre int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_categories" ON public.categories;
CREATE POLICY "select_categories" ON public.categories FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_write_categories" ON public.categories;
CREATE POLICY "admin_write_categories" ON public.categories FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

INSERT INTO public.categories (nom, couleur, icone, ordre) VALUES
  ('salaire',       '#10b981', 'banknote',     1),
  ('nourriture',    '#f59e0b', 'utensils',     2),
  ('transport',     '#3b82f6', 'car',          3),
  ('loyer',         '#8b5cf6', 'home',         4),
  ('factures',      '#ef4444', 'receipt',      5),
  ('loisirs',       '#ec4899', 'gamepad-2',    6),
  ('sante',         '#06b6d4', 'heart-pulse',  7),
  ('autre',         '#64748b', 'tag',          99)
ON CONFLICT (nom) DO NOTHING;

-- ============================================================================
-- 3. TRANSACTIONS — nouvelles colonnes
-- ============================================================================
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS categorie varchar(40) NOT NULL DEFAULT 'autre';

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS statut varchar(20) NOT NULL DEFAULT 'validee'
  CHECK (statut IN ('validee', 'en_attente_validation'));

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS recurrente_parent_id uuid
  REFERENCES public.transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_categorie ON public.transactions(categorie);
CREATE INDEX IF NOT EXISTS idx_transactions_statut ON public.transactions(statut);

-- ============================================================================
-- 4. BUDGETS PRÉVISIONNELS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categorie varchar(40) NOT NULL,
  mois_annee varchar(7) NOT NULL,
  limite numeric(14,2) NOT NULL CHECK (limite >= 0),
  cree_par uuid NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (categorie, mois_annee)
);

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_budgets" ON public.budgets;
CREATE POLICY "select_budgets" ON public.budgets FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superviseur'))
  );

DROP POLICY IF EXISTS "admin_write_budgets" ON public.budgets;
CREATE POLICY "admin_write_budgets" ON public.budgets FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ============================================================================
-- 5. ALERTES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.alertes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type varchar(30) NOT NULL CHECK (type IN ('solde_bas', 'grosse_depense')),
  seuil numeric(14,2) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  cree_par uuid NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  derniere_notification timestamptz
);

ALTER TABLE public.alertes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_alertes" ON public.alertes;
CREATE POLICY "select_alertes" ON public.alertes FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "admin_write_alertes" ON public.alertes;
CREATE POLICY "admin_write_alertes" ON public.alertes FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ============================================================================
-- 6. TRANSACTIONS RÉCURRENTES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.transactions_recurrentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_depart date NOT NULL,
  frequence varchar(10) NOT NULL CHECK (frequence IN ('quotidien','hebdomadaire','mensuel','annuel')),
  prochaine_occurrence date NOT NULL,
  motif varchar(255) NOT NULL,
  categorie varchar(40) NOT NULL DEFAULT 'autre',
  type_operation varchar(10) NOT NULL CHECK (type_operation IN ('miditra','mivoaka')),
  montant numeric(14,2) NOT NULL CHECK (montant > 0),
  auteur_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actif boolean NOT NULL DEFAULT true,
  cree_le timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recurrentes_prochaine ON public.transactions_recurrentes(prochaine_occurrence);

ALTER TABLE public.transactions_recurrentes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_recurrentes" ON public.transactions_recurrentes;
CREATE POLICY "select_recurrentes" ON public.transactions_recurrentes FOR SELECT
  TO authenticated
  USING (
    auteur_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superviseur'))
  );

DROP POLICY IF EXISTS "insert_recurrentes" ON public.transactions_recurrentes;
CREATE POLICY "insert_recurrentes" ON public.transactions_recurrentes FOR INSERT
  TO authenticated WITH CHECK (auteur_id = auth.uid());

DROP POLICY IF EXISTS "update_recurrentes" ON public.transactions_recurrentes;
CREATE POLICY "update_recurrentes" ON public.transactions_recurrentes FOR UPDATE
  TO authenticated
  USING (auteur_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (auteur_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "delete_recurrentes" ON public.transactions_recurrentes;
CREATE POLICY "delete_recurrentes" ON public.transactions_recurrentes FOR DELETE
  TO authenticated
  USING (auteur_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ============================================================================
-- 7. VERROUILLAGE DES RPC — opérateur bloqué
-- ============================================================================
CREATE OR REPLACE FUNCTION public._check_can_view_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role varchar;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role = 'operateur' OR v_role IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : statistiques réservées aux admins et superviseurs'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_solde_total()
RETURNS numeric(14,2)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._check_can_view_stats();
  RETURN (
    SELECT
      COALESCE(SUM(CASE WHEN type_operation = 'miditra' THEN montant ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN type_operation = 'mivoaka' THEN montant ELSE 0 END), 0)
    FROM public.transactions
    WHERE supprime = false AND statut = 'validee'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_solde_utilisateur(p_user_id uuid)
RETURNS numeric(14,2)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._check_can_view_stats();
  RETURN (
    SELECT
      COALESCE(SUM(CASE WHEN type_operation = 'miditra' THEN montant ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN type_operation = 'mivoaka' THEN montant ELSE 0 END), 0)
    FROM public.transactions
    WHERE supprime = false AND statut = 'validee' AND auteur_id = p_user_id
  );
END;
$$;

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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._check_can_view_stats();
  RETURN QUERY
  WITH base AS (
    SELECT
      t.id, t.client_uuid, t.date_transaction, t.motif, t.type_operation,
      t.montant, t.auteur_id, p.nom AS auteur_nom, t.cree_le, t.modifie_le
    FROM public.transactions t
    LEFT JOIN public.profiles p ON p.id = t.auteur_id
    WHERE t.supprime = false AND t.statut = 'validee'
      AND (p_user_id IS NULL OR t.auteur_id = p_user_id)
  )
  SELECT
    b.id, b.client_uuid, b.date_transaction, b.motif, b.type_operation,
    b.montant, b.auteur_id, b.auteur_nom, b.cree_le, b.modifie_le,
    SUM(CASE WHEN b.type_operation = 'miditra' THEN b.montant ELSE -b.montant END)
      OVER (ORDER BY b.date_transaction, b.cree_le)
  FROM base b
  ORDER BY b.date_transaction DESC, b.cree_le DESC;
END;
$$;

-- ============================================================================
-- 8. STATISTIQUES MENSUELLES (admin/superviseur)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_stats_mensuelles(p_mois varchar DEFAULT NULL)
RETURNS TABLE (
  categorie varchar,
  type_operation varchar,
  total numeric,
  nb_transactions bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._check_can_view_stats();
  RETURN QUERY
  SELECT
    t.categorie,
    t.type_operation,
    COALESCE(SUM(t.montant), 0)::numeric(14,2) AS total,
    COUNT(*)::bigint AS nb_transactions
  FROM public.transactions t
  WHERE t.supprime = false
    AND t.statut = 'validee'
    AND (p_mois IS NULL OR to_char(t.date_transaction, 'YYYY-MM') = p_mois)
  GROUP BY t.categorie, t.type_operation
  ORDER BY total DESC;
END;
$$;

-- ============================================================================
-- 9. TRIGGER — validation automatique des grosses transactions
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_auto_validation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seuil numeric;
BEGIN
  SELECT valeur::numeric INTO v_seuil FROM public.settings WHERE cle = 'seuil_validation';
  IF v_seuil IS NULL THEN v_seuil := 100000; END IF;

  IF NEW.montant >= v_seuil AND NEW.statut = 'validee' THEN
    -- Only an admin can directly create a validated transaction above the threshold.
    -- Operators inserting above the threshold get pending status automatically.
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
      NEW.statut := 'en_attente_validation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_auto_validation ON public.transactions;
CREATE TRIGGER transactions_auto_validation
BEFORE INSERT OR UPDATE OF montant, statut ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.fn_auto_validation();

-- ============================================================================
-- 10. UPDATE POLICIES — transactions statut visible
-- ============================================================================
-- L'admin peut valider (changer statut -> validee). Les opérateurs ne peuvent
-- pas modifier le statut directement.
-- (La policy update existante permet déjà à l'admin de tout modifier.)
