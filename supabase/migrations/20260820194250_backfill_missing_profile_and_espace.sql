/*
# Backfill missing profile + default espace for existing user

## Problem
User `nymarandria@gmail.com` (id: ce859b8d-fc0f-4d36-abe7-90edb7f2c132) 
was created on Aug 19 BEFORE the `on_auth_user_created` trigger was set up.
As a result, they have an auth.users row but no profile, no espace, and no
user_espaces link. The app shows them an empty state with no espace.

## Changes
1. Insert the missing profile row (as admin, since they're the first/only user)
2. Insert a default "Mon Espace" espace
3. Link the user to the espace as admin
*/
DO $$
DECLARE
  v_user_id uuid := 'ce859b8d-fc0f-4d36-abe7-90edb7f2c132';
  v_espace_id uuid;
  v_profile_count integer;
  v_espace_count integer;
BEGIN
  -- Check if profile already exists
  SELECT count(*) INTO v_profile_count FROM public.profiles WHERE id = v_user_id;
  IF v_profile_count = 0 THEN
    INSERT INTO public.profiles (id, nom, email, role, langue, actif)
    VALUES (v_user_id, 'Ny Marandria', 'nymarandria@gmail.com', 'admin', 'fr', true);
  END IF;

  -- Check if user already has an espace
  SELECT count(*) INTO v_espace_count 
  FROM public.user_espaces WHERE user_id = v_user_id;
  IF v_espace_count = 0 THEN
    INSERT INTO public.espaces (nom, cree_par)
    VALUES ('Mon Espace', v_user_id)
    RETURNING id INTO v_espace_id;

    INSERT INTO public.user_espaces (user_id, espace_id, role_dans_espace)
    VALUES (v_user_id, v_espace_id, 'admin');
  END IF;
END $$;
