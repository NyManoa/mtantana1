/*
# Fix: every new user gets a default "Principal" espace

## Problem
The on_auth_user_created trigger only created a default espace for the
very first user (when profile_count = 1). All subsequent users got no
espace, and since they're "operateur" (not admin), they couldn't create
one either. This left them stuck on the "no espace" screen with no form,
and the import page did nothing (it returns early when currentEspace is null).

## Solution
Create a default "Principal" espace for EVERY new user who signs up.
The first user becomes admin of their espace; subsequent users are
operateur of their own espace. This way every user can start using
the app immediately after signup.
*/

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nom text;
  v_role text;
  v_langue text;
  v_profile_count int;
  v_espace_id uuid;
  v_final_role text;
BEGIN
  -- Extract metadata from the user's raw_user_meta_data
  v_nom := COALESCE(NEW.raw_user_meta_data->>'nom', split_part(NEW.email, '@', 1));
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'operateur');
  v_langue := COALESCE(NEW.raw_user_meta_data->>'langue', 'fr');

  -- Insert profile (fn_first_user_admin trigger will override role if first user)
  INSERT INTO public.profiles (id, nom, email, role, langue, actif)
  VALUES (NEW.id, v_nom, NEW.email, v_role, v_langue, true)
  ON CONFLICT (id) DO NOTHING;

  -- Determine the actual role after the first-user-admin trigger may have overridden it
  SELECT role INTO v_final_role FROM public.profiles WHERE id = NEW.id;

  -- Create a default "Principal" espace for every new user
  INSERT INTO public.espaces (nom, cree_par)
  VALUES ('Principal', NEW.id)
  RETURNING id INTO v_espace_id;

  -- Assign the user to their default espace with their actual role
  INSERT INTO public.user_espaces (user_id, espace_id, role_dans_espace)
  VALUES (NEW.id, v_espace_id, v_final_role)
  ON CONFLICT (user_id, espace_id) DO NOTHING;

  RETURN NEW;
END;
$$;
