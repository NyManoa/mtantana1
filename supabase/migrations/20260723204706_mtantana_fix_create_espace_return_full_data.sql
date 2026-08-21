-- Update create_espace RPC to return full espace data
CREATE OR REPLACE FUNCTION public.create_espace(p_nom text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_espace_id uuid;
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Non authentifié';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = v_user_id AND p.role = 'admin') THEN
    RAISE EXCEPTION 'Accès refusé — admin uniquement';
  END IF;

  INSERT INTO espaces (nom, cree_par)
  VALUES (p_nom, v_user_id)
  RETURNING id INTO v_espace_id;

  INSERT INTO user_espaces (user_id, espace_id, role_dans_espace)
  VALUES (v_user_id, v_espace_id, 'admin')
  ON CONFLICT (user_id, espace_id) DO NOTHING;

  RETURN jsonb_build_object(
    'id', v_espace_id,
    'nom', p_nom,
    'cree_le', v_now,
    'role_dans_espace', 'admin',
    'success', true
  );
END;
$$;
