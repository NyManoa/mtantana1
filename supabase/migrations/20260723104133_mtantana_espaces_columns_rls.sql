/*
# M'tantana — ajout colonne espace_id sur les tables existantes + RLS + RPC
*/

-- TRANSACTIONS
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS espace_id uuid REFERENCES public.espaces(id) ON DELETE CASCADE;
UPDATE public.transactions SET espace_id = (SELECT id FROM public.espaces WHERE nom = 'Principal' LIMIT 1) WHERE espace_id IS NULL;
ALTER TABLE public.transactions ALTER COLUMN espace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_espace ON public.transactions(espace_id);

DROP POLICY IF EXISTS "select_transactions" ON public.transactions;
CREATE POLICY "select_transactions" ON public.transactions FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = transactions.espace_id));

DROP POLICY IF EXISTS "insert_transactions" ON public.transactions;
CREATE POLICY "insert_transactions" ON public.transactions FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = transactions.espace_id));

DROP POLICY IF EXISTS "update_transactions" ON public.transactions;
CREATE POLICY "update_transactions" ON public.transactions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = transactions.espace_id AND ue.role_dans_espace IN ('admin','superviseur'))
    OR auteur_id = auth.uid()
  )
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = transactions.espace_id));

DROP POLICY IF EXISTS "delete_transactions" ON public.transactions;
CREATE POLICY "delete_transactions" ON public.transactions FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = transactions.espace_id AND ue.role_dans_espace IN ('admin','superviseur'))
    OR auteur_id = auth.uid()
  );

-- TRANSACTIONS_RECURRENTES
ALTER TABLE public.transactions_recurrentes ADD COLUMN IF NOT EXISTS espace_id uuid REFERENCES public.espaces(id) ON DELETE CASCADE;
UPDATE public.transactions_recurrentes SET espace_id = (SELECT id FROM public.espaces WHERE nom = 'Principal' LIMIT 1) WHERE espace_id IS NULL;
ALTER TABLE public.transactions_recurrentes ALTER COLUMN espace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recurrentes_espace ON public.transactions_recurrentes(espace_id);

DROP POLICY IF EXISTS "select_recurrentes" ON public.transactions_recurrentes;
CREATE POLICY "select_recurrentes" ON public.transactions_recurrentes FOR SELECT
  TO authenticated
  USING (
    auteur_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = transactions_recurrentes.espace_id AND ue.role_dans_espace IN ('admin','superviseur'))
  );

DROP POLICY IF EXISTS "insert_recurrentes" ON public.transactions_recurrentes;
CREATE POLICY "insert_recurrentes" ON public.transactions_recurrentes FOR INSERT
  TO authenticated WITH CHECK (auteur_id = auth.uid() AND EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = transactions_recurrentes.espace_id));

DROP POLICY IF EXISTS "update_recurrentes" ON public.transactions_recurrentes;
CREATE POLICY "update_recurrentes" ON public.transactions_recurrentes FOR UPDATE
  TO authenticated
  USING (auteur_id = auth.uid() OR EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = transactions_recurrentes.espace_id AND ue.role_dans_espace = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = transactions_recurrentes.espace_id));

DROP POLICY IF EXISTS "delete_recurrentes" ON public.transactions_recurrentes;
CREATE POLICY "delete_recurrentes" ON public.transactions_recurrentes FOR DELETE
  TO authenticated
  USING (auteur_id = auth.uid() OR EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = transactions_recurrentes.espace_id AND ue.role_dans_espace = 'admin'));

-- TRANSACTIONS_PLANIFIEES
ALTER TABLE public.transactions_planifiees ADD COLUMN IF NOT EXISTS espace_id uuid REFERENCES public.espaces(id) ON DELETE CASCADE;
UPDATE public.transactions_planifiees SET espace_id = (SELECT id FROM public.espaces WHERE nom = 'Principal' LIMIT 1) WHERE espace_id IS NULL;
ALTER TABLE public.transactions_planifiees ALTER COLUMN espace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_planifiees_espace ON public.transactions_planifiees(espace_id);

DROP POLICY IF EXISTS "select_planifiees" ON public.transactions_planifiees;
CREATE POLICY "select_planifiees" ON public.transactions_planifiees FOR SELECT
  TO authenticated
  USING (
    auteur_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = transactions_planifiees.espace_id AND ue.role_dans_espace IN ('admin','superviseur'))
  );

DROP POLICY IF EXISTS "insert_planifiees" ON public.transactions_planifiees;
CREATE POLICY "insert_planifiees" ON public.transactions_planifiees FOR INSERT
  TO authenticated WITH CHECK (auteur_id = auth.uid() AND EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = transactions_planifiees.espace_id));

DROP POLICY IF EXISTS "update_planifiees" ON public.transactions_planifiees;
CREATE POLICY "update_planifiees" ON public.transactions_planifiees FOR UPDATE
  TO authenticated
  USING (auteur_id = auth.uid() OR EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = transactions_planifiees.espace_id AND ue.role_dans_espace = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = transactions_planifiees.espace_id));

DROP POLICY IF EXISTS "delete_planifiees" ON public.transactions_planifiees;
CREATE POLICY "delete_planifiees" ON public.transactions_planifiees FOR DELETE
  TO authenticated
  USING (auteur_id = auth.uid() OR EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = transactions_planifiees.espace_id AND ue.role_dans_espace = 'admin'));

-- BUDGETS
ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS espace_id uuid REFERENCES public.espaces(id) ON DELETE CASCADE;
UPDATE public.budgets SET espace_id = (SELECT id FROM public.espaces WHERE nom = 'Principal' LIMIT 1) WHERE espace_id IS NULL;
ALTER TABLE public.budgets ALTER COLUMN espace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budgets_espace ON public.budgets(espace_id);

DROP POLICY IF EXISTS "select_budgets" ON public.budgets;
CREATE POLICY "select_budgets" ON public.budgets FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = budgets.espace_id AND ue.role_dans_espace IN ('admin','superviseur')));

DROP POLICY IF EXISTS "admin_write_budgets" ON public.budgets;
CREATE POLICY "admin_write_budgets" ON public.budgets FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = budgets.espace_id AND ue.role_dans_espace = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = budgets.espace_id AND ue.role_dans_espace = 'admin'));

-- ALERTES
ALTER TABLE public.alertes ADD COLUMN IF NOT EXISTS espace_id uuid REFERENCES public.espaces(id) ON DELETE CASCADE;
UPDATE public.alertes SET espace_id = (SELECT id FROM public.espaces WHERE nom = 'Principal' LIMIT 1) WHERE espace_id IS NULL;
ALTER TABLE public.alertes ALTER COLUMN espace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alertes_espace ON public.alertes(espace_id);

DROP POLICY IF EXISTS "select_alertes" ON public.alertes;
CREATE POLICY "select_alertes" ON public.alertes FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = alertes.espace_id AND ue.role_dans_espace = 'admin'));

DROP POLICY IF EXISTS "admin_write_alertes" ON public.alertes;
CREATE POLICY "admin_write_alertes" ON public.alertes FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = alertes.espace_id AND ue.role_dans_espace = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = alertes.espace_id AND ue.role_dans_espace = 'admin'));

-- JOURNAL_AUDIT
ALTER TABLE public.journal_audit ADD COLUMN IF NOT EXISTS espace_id uuid REFERENCES public.espaces(id) ON DELETE CASCADE;
UPDATE public.journal_audit SET espace_id = (SELECT id FROM public.espaces WHERE nom = 'Principal' LIMIT 1) WHERE espace_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_audit_espace ON public.journal_audit(espace_id);

ALTER TABLE public.journal_audit DROP CONSTRAINT IF EXISTS journal_audit_action_check;
ALTER TABLE public.journal_audit ADD CONSTRAINT journal_audit_action_check
  CHECK (action IN ('creation','modification','suppression','validation','import'));

DROP POLICY IF EXISTS "select_audit" ON public.journal_audit;
CREATE POLICY "select_audit" ON public.journal_audit FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = journal_audit.espace_id AND ue.role_dans_espace = 'admin'));

DROP POLICY IF EXISTS "insert_audit" ON public.journal_audit;
CREATE POLICY "insert_audit" ON public.journal_audit FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = journal_audit.espace_id));

-- TRIGGER : auto-set espace_id on transactions
CREATE OR REPLACE FUNCTION public.fn_transactions_set_espace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_espace_id uuid;
BEGIN
  IF NEW.espace_id IS NULL THEN
    SELECT ue.espace_id INTO v_espace_id
    FROM public.user_espaces ue
    WHERE ue.user_id = NEW.auteur_id
    ORDER BY ue.espace_id
    LIMIT 1;
    IF v_espace_id IS NULL THEN
      SELECT id INTO v_espace_id FROM public.espaces LIMIT 1;
    END IF;
    NEW.espace_id := v_espace_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_set_espace ON public.transactions;
CREATE TRIGGER transactions_set_espace
BEFORE INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.fn_transactions_set_espace();

-- TRIGGER : auto-set espace_id on journal_audit
CREATE OR REPLACE FUNCTION public.fn_audit_set_espace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.espace_id IS NULL THEN
    SELECT ue.espace_id INTO NEW.espace_id
    FROM public.user_espaces ue
    WHERE ue.user_id = NEW.utilisateur_id
    ORDER BY ue.espace_id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS journal_audit_set_espace ON public.journal_audit;
CREATE TRIGGER journal_audit_set_espace
BEFORE INSERT ON public.journal_audit
FOR EACH ROW EXECUTE FUNCTION public.fn_audit_set_espace();

-- RPC : update with p_espace_id parameter
CREATE OR REPLACE FUNCTION public.get_solde_total(p_espace_id uuid DEFAULT NULL)
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
      AND (p_espace_id IS NULL OR espace_id = p_espace_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_solde_utilisateur(p_user_id uuid, p_espace_id uuid DEFAULT NULL)
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
      AND (p_espace_id IS NULL OR espace_id = p_espace_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_historique_solde(p_user_id uuid DEFAULT NULL, p_espace_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid, client_uuid uuid, date_transaction date, motif varchar,
  type_operation varchar, montant numeric, auteur_id uuid, auteur_nom varchar,
  cree_le timestamptz, modifie_le timestamptz, solde_apres_operation numeric
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
    SELECT t.id, t.client_uuid, t.date_transaction, t.motif, t.type_operation,
      t.montant, t.auteur_id, p.nom AS auteur_nom, t.cree_le, t.modifie_le
    FROM public.transactions t
    LEFT JOIN public.profiles p ON p.id = t.auteur_id
    WHERE t.supprime = false AND t.statut = 'validee'
      AND (p_user_id IS NULL OR t.auteur_id = p_user_id)
      AND (p_espace_id IS NULL OR t.espace_id = p_espace_id)
  )
  SELECT b.id, b.client_uuid, b.date_transaction, b.motif, b.type_operation,
    b.montant, b.auteur_id, b.auteur_nom, b.cree_le, b.modifie_le,
    SUM(CASE WHEN b.type_operation = 'miditra' THEN b.montant ELSE -b.montant END)
      OVER (ORDER BY b.date_transaction, b.cree_le)
  FROM base b
  ORDER BY b.date_transaction DESC, b.cree_le DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_stats_mensuelles(p_mois varchar DEFAULT NULL, p_espace_id uuid DEFAULT NULL)
RETURNS TABLE (
  categorie varchar, type_operation varchar, total numeric, nb_transactions bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._check_can_view_stats();
  RETURN QUERY
  SELECT t.categorie, t.type_operation,
    COALESCE(SUM(t.montant), 0)::numeric(14,2) AS total,
    COUNT(*)::bigint AS nb_transactions
  FROM public.transactions t
  WHERE t.supprime = false AND t.statut = 'validee'
    AND (p_mois IS NULL OR to_char(t.date_transaction, 'YYYY-MM') = p_mois)
    AND (p_espace_id IS NULL OR t.espace_id = p_espace_id)
  GROUP BY t.categorie, t.type_operation
  ORDER BY total DESC;
END;
$$;
