-- Fix circular RLS on user_espaces insert: allow admin (from profiles) to self-assign or assign others
DROP POLICY IF EXISTS "insert_user_espaces" ON public.user_espaces;
CREATE POLICY "insert_user_espaces" ON public.user_espaces FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Self-assignment: user is admin in profiles and assigning themselves
    (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
    -- Or: user is already admin of the target espace
    OR EXISTS (SELECT 1 FROM public.user_espaces ue2 WHERE ue2.user_id = auth.uid() AND ue2.espace_id = user_espaces.espace_id AND ue2.role_dans_espace = 'admin')
  );

-- Allow update on user_espaces (for role changes)
DROP POLICY IF EXISTS "update_user_espaces" ON public.user_espaces;
CREATE POLICY "update_user_espaces" ON public.user_espaces FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_espaces ue2 WHERE ue2.user_id = auth.uid() AND ue2.espace_id = user_espaces.espace_id AND ue2.role_dans_espace = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_espaces ue2 WHERE ue2.user_id = auth.uid() AND ue2.espace_id = user_espaces.espace_id AND ue2.role_dans_espace = 'admin')
  );

-- Allow admin to delete espaces they created
DROP POLICY IF EXISTS "delete_espaces" ON public.espaces;
CREATE POLICY "delete_espaces" ON public.espaces FOR DELETE
  TO authenticated
  USING (
    cree_par = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = espaces.id AND ue.role_dans_espace = 'admin')
  );

-- Allow admin to update espace name
DROP POLICY IF EXISTS "update_espaces" ON public.espaces;
CREATE POLICY "update_espaces" ON public.espaces FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = espaces.id AND ue.role_dans_espace = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = espaces.id AND ue.role_dans_espace = 'admin')
  );

-- Add RPC to reset an espace (delete all transactions, budgets, alertes, recurrentes, planifiees)
-- but keep the espace and user assignments
CREATE OR REPLACE FUNCTION public.reset_espace(p_espace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Check caller is admin of this espace
  IF NOT EXISTS (SELECT 1 FROM user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = p_espace_id AND ue.role_dans_espace = 'admin') THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  -- Delete all data in this espace
  DELETE FROM transactions WHERE espace_id = p_espace_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM transactions_recurrentes WHERE espace_id = p_espace_id;
  DELETE FROM transactions_planifiees WHERE espace_id = p_espace_id;
  DELETE FROM budgets WHERE espace_id = p_espace_id;
  DELETE FROM alertes WHERE espace_id = p_espace_id;
  DELETE FROM journal_audit WHERE espace_id = p_espace_id;

  RETURN jsonb_build_object('deleted_transactions', v_count, 'reset', true);
END;
$$;

-- Add RPC to delete an espace entirely
CREATE OR REPLACE FUNCTION public.delete_espace(p_espace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check caller is admin of this espace
  IF NOT EXISTS (SELECT 1 FROM user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = p_espace_id AND ue.role_dans_espace = 'admin') THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  -- Prevent deleting if it's the only espace
  IF (SELECT COUNT(*) FROM espaces) <= 1 THEN
    RAISE EXCEPTION 'Impossible de supprimer le dernier espace';
  END IF;

  -- Delete all data and the espace itself (cascades will handle child tables)
  DELETE FROM user_espaces WHERE espace_id = p_espace_id;
  DELETE FROM espaces WHERE id = p_espace_id;

  RETURN jsonb_build_object('deleted', true);
END;
$$;
