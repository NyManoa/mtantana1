/*
# Fix: don't create "Principal" espace for admin-created users

## Problem
handle_new_auth_user always creates a "Principal" espace for every
new user. When an admin creates an operateur/superviseur via the
Users page, that user gets their own "Principal" espace in addition
to being assigned to the admin's espace. This breaks isolation —
the operateur would see their own private espace.

## Solution
Only create the default "Principal" espace when no role is specified
in metadata (self-signup). When a role IS specified (admin-created
user), skip the default espace creation — the edge function handles
espace assignment to the admin's espace.
*/

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
  v_espace_id uuid;
  v_final_role text;
  v_has_role_meta boolean;
BEGIN
  v_nom := COALESCE(NEW.raw_user_meta_data->>'nom', split_part(NEW.email, '@', 1));
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'admin');
  v_langue := COALESCE(NEW.raw_user_meta_data->>'langue', 'fr');
  v_has_role_meta := NEW.raw_user_meta_data ? 'role';

  INSERT INTO public.profiles (id, nom, email, role, langue, actif)
  VALUES (NEW.id, v_nom, NEW.email, v_role, v_langue, true)
  ON CONFLICT (id) DO NOTHING;

  SELECT role INTO v_final_role FROM public.profiles WHERE id = NEW.id;

  -- Only create a default "Principal" espace for self-signup users
  -- (no role in metadata). Admin-created users get their espace
  -- assignment from the edge function.
  IF NOT v_has_role_meta THEN
    INSERT INTO public.espaces (nom, cree_par)
    VALUES ('Principal', NEW.id)
    RETURNING id INTO v_espace_id;

    INSERT INTO public.user_espaces (user_id, espace_id, role_dans_espace)
    VALUES (NEW.id, v_espace_id, v_final_role)
    ON CONFLICT (user_id, espace_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;
