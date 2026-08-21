/*
# Fix auth trigger, espace RPCs, and per-user categories

## Problem
After database reset:
- No trigger on auth.users creates a profile or default espace on signup
- create_espace, delete_espace, reset_espace RPCs are missing
- Categories are global (shared by all users) instead of per-user

## Changes

### 1. Auth trigger (on_auth_user_created)
- Creates a profile row automatically when a new auth.users row is inserted
- Sets first user as admin, others as operateur
- Creates a default "Mon Espace" for the new user
- Links the user to their espace via user_espaces

### 2. create_espace RPC
- SECURITY DEFINER function that creates a new espace
- Links the calling user as admin of the new espace
- Returns the new espace's full data

### 3. delete_espace RPC
- SECURITY DEFINER function that deletes an espace
- Only the creator can delete it
- CASCADE deletes handle user_espaces, transactions, etc.

### 4. reset_espace RPC
- SECURITY DEFINER function that deletes all transactions in an espace
- Only an admin of the espace can reset it

### 5. Per-user categories
- Add user_id column to categories table (nullable for default/global categories)
- Default categories remain global (user_id IS NULL)
- User-created categories have user_id set to the creator
- RLS: users can SELECT global categories + their own; users can INSERT/UPDATE/DELETE only their own

### 6. Category name
- Remove the cat_ prefix convention — store the raw name as typed by the user
*/

-- ============================================================
-- 1. Auth trigger: auto-create profile + default espace on signup
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nom text;
  v_role varchar;
  v_count integer;
  v_espace_id uuid;
BEGIN
  -- Extract name from user metadata, fallback to email prefix
  v_nom := COALESCE(NEW.raw_user_meta_data->>'nom', split_part(NEW.email, '@', 1));

  -- Determine role: first user is admin, others are operateur
  SELECT count(*) INTO v_count FROM public.profiles;
  IF v_count = 0 THEN
    v_role := 'admin';
  ELSE
    v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'operateur');
  END IF;

  -- Create profile
  INSERT INTO public.profiles (id, nom, email, role, langue, actif)
  VALUES (NEW.id, v_nom, NEW.email, v_role, COALESCE(NEW.raw_user_meta_data->>'langue', 'fr'), true);

  -- Create default espace for the new user
  INSERT INTO public.espaces (nom, cree_par)
  VALUES ('Mon Espace', NEW.id)
  RETURNING id INTO v_espace_id;

  -- Link user to their espace as admin
  INSERT INTO public.user_espaces (user_id, espace_id, role_dans_espace)
  VALUES (NEW.id, v_espace_id, 'admin');

  RETURN NEW;
END;
$function$;

-- Drop old trigger if exists, create new one
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_handle_new_user();

-- ============================================================
-- 2. create_espace RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_espace(p_nom text)
RETURNS TABLE(id uuid, nom text, cree_le timestamptz, role_dans_espace varchar)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_espace_id uuid;
  v_cree_le timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Create the espace
  INSERT INTO public.espaces (nom, cree_par)
  VALUES (p_nom, auth.uid())
  RETURNING id, cree_le INTO v_espace_id, v_cree_le;

  -- Link the calling user as admin of the new espace
  INSERT INTO public.user_espaces (user_id, espace_id, role_dans_espace)
  VALUES (auth.uid(), v_espace_id, 'admin');

  RETURN QUERY SELECT v_espace_id, p_nom, v_cree_le, 'admin'::varchar;
END;
$function$;

-- ============================================================
-- 3. delete_espace RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_espace(p_espace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Only the creator can delete
  IF NOT EXISTS (
    SELECT 1 FROM public.espaces
    WHERE id = p_espace_id AND cree_par = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized to delete this espace';
  END IF;

  -- CASCADE will handle user_espaces, transactions, etc.
  DELETE FROM public.espaces WHERE id = p_espace_id;
END;
$function$;

-- ============================================================
-- 4. reset_espace RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.reset_espace(p_espace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Only an admin of the espace can reset
  IF NOT EXISTS (
    SELECT 1 FROM public.user_espaces
    WHERE user_id = auth.uid()
      AND espace_id = p_espace_id
      AND role_dans_espace = 'admin'
  ) THEN
    RAISE EXCEPTION 'Not authorized to reset this espace';
  END IF;

  -- Delete all transactions in this espace
  DELETE FROM public.transactions WHERE espace_id = p_espace_id;
END;
$function$;

-- ============================================================
-- 5. Per-user categories: add user_id column
-- ============================================================

ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS user_id uuid;

-- Add foreign key constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'categories_user_id_fkey'
      AND table_name = 'categories'
  ) THEN
    ALTER TABLE public.categories
    ADD CONSTRAINT categories_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add index for user_id lookups
CREATE INDEX IF NOT EXISTS idx_categories_user_id ON public.categories(user_id);

-- ============================================================
-- 6. Categories RLS: per-user isolation
-- ============================================================

-- Drop existing policies
DROP POLICY IF EXISTS "select_categories" ON public.categories;
DROP POLICY IF EXISTS "admin_write_categories" ON public.categories;

-- SELECT: users can see global categories (user_id IS NULL) + their own
CREATE POLICY "select_categories" ON public.categories
  FOR SELECT TO authenticated
  USING (user_id IS NULL OR user_id = auth.uid());

-- INSERT: users can only create categories for themselves
CREATE POLICY "insert_categories" ON public.categories
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- UPDATE: users can only update their own categories
CREATE POLICY "update_categories" ON public.categories
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- DELETE: users can only delete their own categories
CREATE POLICY "delete_categories" ON public.categories
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ============================================================
-- 7. Update espaces RLS: allow any user to create espaces
-- ============================================================

DROP POLICY IF EXISTS "insert_espaces" ON public.espaces;
CREATE POLICY "insert_espaces" ON public.espaces
  FOR INSERT TO authenticated
  WITH CHECK (cree_par = auth.uid());

-- ============================================================
-- 8. Grant EXECUTE on RPCs to authenticated
-- ============================================================

GRANT EXECUTE ON FUNCTION public.create_espace(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_espace(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_espace(uuid) TO authenticated;
