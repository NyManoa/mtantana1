-- Fix reset_espace RPC: use profiles-based admin check (consistent with delete_espace)
CREATE OR REPLACE FUNCTION public.reset_espace(p_espace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Check caller is a global admin
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
    RAISE EXCEPTION 'Accès refusé — admin uniquement';
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
