/*
# Fix create_espace ambiguity + user_espaces RLS recursion

## Problems
1. `create_espace` throws "column reference 'id' is ambiguous" because
   the RETURNING clause's `id` and `cree_le` columns conflict with the
   function's RETURNS TABLE output column names.
2. `user_espaces` SELECT policy has infinite RLS recursion: the policy
   references `user_espaces` in its own EXISTS subquery, which triggers
   the same policy again. This causes the espace loading query to fail
   silently, so the app shows the "create espace" page even when the
   user already has an espace.

## Changes
1. Rewrite `create_espace` with table-qualified column names to avoid ambiguity.
2. Create a `is_admin_in_espace` SECURITY DEFINER helper that bypasses RLS
   to check admin status without recursion.
3. Rewrite `user_espaces` SELECT policy to use the helper instead of
   self-referencing EXISTS.
*/

-- ============================================================
-- 1. Fix create_espace: table-qualify all column references
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_espace(p_nom text)
RETURNS TABLE(id uuid, nom text, cree_le timestamp with time zone, role_dans_espace character varying)
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

  -- Create the espace (table-qualify RETURNING columns to avoid ambiguity with RETURNS TABLE)
  INSERT INTO public.espaces (nom, cree_par)
  VALUES (p_nom, auth.uid())
  RETURNING espaces.id, espaces.cree_le INTO v_espace_id, v_cree_le;

  -- Link the calling user as admin of the new espace
  INSERT INTO public.user_espaces (user_id, espace_id, role_dans_espace)
  VALUES (auth.uid(), v_espace_id, 'admin');

  RETURN QUERY SELECT v_espace_id, p_nom, v_cree_le, 'admin'::varchar;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_espace(text) TO authenticated;

-- ============================================================
-- 2. Create is_admin_in_espace helper (SECURITY DEFINER, bypasses RLS)
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_admin_in_espace(p_espace_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.user_espaces
    WHERE user_id = p_user_id
      AND espace_id = p_espace_id
      AND role_dans_espace = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_in_espace(uuid, uuid) TO authenticated;

-- ============================================================
-- 3. Fix user_espaces SELECT policy: remove recursion
-- ============================================================

DROP POLICY IF EXISTS "select_user_espaces" ON public.user_espaces;

CREATE POLICY "select_user_espaces" ON public.user_espaces
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_admin_in_espace(espace_id, auth.uid())
  );

-- ============================================================
-- 4. Fix user_espaces INSERT policy: remove recursion
-- ============================================================

DROP POLICY IF EXISTS "insert_user_espaces" ON public.user_espaces;

CREATE POLICY "insert_user_espaces" ON public.user_espaces
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_admin_in_espace(espace_id, auth.uid())
  );

-- ============================================================
-- 5. Fix user_espaces DELETE policy: remove recursion
-- ============================================================

DROP POLICY IF EXISTS "delete_user_espaces" ON public.user_espaces;

CREATE POLICY "delete_user_espaces" ON public.user_espaces
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_admin_in_espace(espace_id, auth.uid())
  );
