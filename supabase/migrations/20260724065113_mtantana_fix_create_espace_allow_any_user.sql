/*
# Fix: allow any authenticated user to create an espace if they have none

## Problem
The create_espace RPC required the caller to be a global admin. But new
users who sign up are "operateur" and can't create espaces. Now every
new user gets a default "Principal" espace via the trigger, but if they
somehow lose it or want to create a second one, they should be able to.

## Solution
Allow any authenticated user to call create_espace. The function creates
the espace and assigns the caller as "admin" of that espace (since they
created it).
*/

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

  INSERT INTO public.espaces (nom, cree_par)
  VALUES (p_nom, v_user_id)
  RETURNING id INTO v_espace_id;

  INSERT INTO public.user_espaces (user_id, espace_id, role_dans_espace)
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
