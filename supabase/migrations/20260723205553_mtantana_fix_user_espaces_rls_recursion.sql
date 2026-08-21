-- Fix infinite recursion in user_espaces RLS policies
-- The old policies queried user_espaces within its own RLS, causing infinite recursion.
-- New approach: check admin status via profiles table (no self-reference).

-- Drop all existing policies
DROP POLICY IF EXISTS select_user_espaces ON public.user_espaces;
DROP POLICY IF EXISTS insert_user_espaces ON public.user_espaces;
DROP POLICY IF EXISTS update_user_espaces ON public.user_espaces;
DROP POLICY IF EXISTS delete_user_espaces ON public.user_espaces;

-- SELECT: user sees their own rows, or all rows if they are a global admin
CREATE POLICY select_user_espaces ON public.user_espaces
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- INSERT: user can insert their own row if they are a global admin
CREATE POLICY insert_user_espaces ON public.user_espaces
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- UPDATE: user can update their own rows, or all rows if they are a global admin
CREATE POLICY update_user_espaces ON public.user_espaces
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- DELETE: user can delete their own rows, or all rows if they are a global admin
CREATE POLICY delete_user_espaces ON public.user_espaces
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );
