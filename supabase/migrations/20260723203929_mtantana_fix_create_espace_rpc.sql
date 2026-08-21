-- Fix: create_espace RPC that atomically creates espace + user_espace assignment
-- This bypasses the circular RLS dependency on select
CREATE OR REPLACE FUNCTION public.create_espace(p_nom text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_espace_id uuid;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Non authentifié';
  END IF;

  -- Check user is admin
  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = v_user_id AND p.role = 'admin') THEN
    RAISE EXCEPTION 'Accès refusé — admin uniquement';
  END IF;

  -- Create the espace
  INSERT INTO espaces (nom, cree_par)
  VALUES (p_nom, v_user_id)
  RETURNING id INTO v_espace_id;

  -- Assign the creator as admin of this espace
  INSERT INTO user_espaces (user_id, espace_id, role_dans_espace)
  VALUES (v_user_id, v_espace_id, 'admin')
  ON CONFLICT (user_id, espace_id) DO NOTHING;

  RETURN jsonb_build_object('id', v_espace_id, 'nom', p_nom, 'success', true);
END;
$$;

-- Also fix select_espaces to allow seeing espaces you created (even before user_espaces assignment)
DROP POLICY IF EXISTS "select_espaces" ON public.espaces;
CREATE POLICY "select_espaces" ON public.espaces FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = espaces.id)
    OR cree_par = auth.uid()
  );
