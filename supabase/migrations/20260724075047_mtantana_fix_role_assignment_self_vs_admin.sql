/*
# Fix: role assignment for self-signup vs admin-created users

## Problem
fn_first_user_admin was forcing EVERY new profile to admin role,
which means admins couldn't create operateur/superviseur users via
the Users page — the trigger would override the role back to admin.

## Solution
1. Revert fn_first_user_admin to only make the FIRST user admin
   (for the initial setup account).
2. Change handle_new_auth_user to default the role to 'admin' when
   no role is specified in metadata (self-signup flow). When an admin
   creates a user via the edge function, the role is explicitly passed
   in metadata, so it won't be overridden.
*/

CREATE OR REPLACE FUNCTION public.fn_first_user_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.profiles;
  IF v_count = 0 THEN
    NEW.role := 'admin';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_nom text;
  v_role text;
  v_langue text;
  v_profile_count int;
  v_espace_id uuid;
  v_final_role text;
BEGIN
  v_nom := COALESCE(NEW.raw_user_meta_data->>'nom', split_part(NEW.email, '@', 1));
  -- Default to 'admin' for self-signup (no role in metadata).
  -- Admin-created users have their role explicitly set in metadata.
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'admin');
  v_langue := COALESCE(NEW.raw_user_meta_data->>'langue', 'fr');

  INSERT INTO public.profiles (id, nom, email, role, langue, actif)
  VALUES (NEW.id, v_nom, NEW.email, v_role, v_langue, true)
  ON CONFLICT (id) DO NOTHING;

  SELECT role INTO v_final_role FROM public.profiles WHERE id = NEW.id;

  INSERT INTO public.espaces (nom, cree_par)
  VALUES ('Principal', NEW.id)
  RETURNING id INTO v_espace_id;

  INSERT INTO public.user_espaces (user_id, espace_id, role_dans_espace)
  VALUES (NEW.id, v_espace_id, v_final_role)
  ON CONFLICT (user_id, espace_id) DO NOTHING;

  RETURN NEW;
END;
$$;
