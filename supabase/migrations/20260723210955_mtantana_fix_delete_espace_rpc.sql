-- Fix delete_espace RPC to check admin via profiles table (avoid any RLS dependency)
CREATE OR REPLACE FUNCTION public.delete_espace(p_espace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  -- Check caller is a global admin
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
    RAISE EXCEPTION 'Accès refusé — admin uniquement';
  END IF;

  -- Prevent deleting if it's the only espace
  SELECT count(*) INTO v_count FROM public.espaces;
  IF v_count <= 1 THEN
    RAISE EXCEPTION 'Impossible de supprimer le dernier espace';
  END IF;

  -- Delete all data and the espace itself (cascades will handle child tables)
  DELETE FROM public.user_espaces WHERE espace_id = p_espace_id;
  DELETE FROM public.espaces WHERE id = p_espace_id;

  RETURN jsonb_build_object('deleted', true);
END;
$$;
