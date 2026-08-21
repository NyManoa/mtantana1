/*
# Fix admin isolation and signup flow

## Changes
1. The `signUp` function in the frontend inserts a profile with role 'operateur'.
   The first-user-admin trigger correctly overrides this to 'admin' for the first user.
   But the trigger uses `SELECT count(*) FROM profiles` which counts ALL profiles,
   including ones created by the admin via the edge function. This is correct behavior:
   only the very first signup becomes admin, all others are operators.

2. The `admin_list_users` RPC currently returns ALL users. This is a security issue:
   an admin should only see users who share at least one espace with them.
   This migration replaces `admin_list_users` with a version that filters by shared espaces.

3. The `signUp` flow does NOT assign the new user to any espace. This means new users
   created via the signup page have no espace and can't see any transactions.
   The admin must assign them via the Users page. This is the intended behavior.

## Security
- `admin_list_users` now only returns users who share at least one espace with the caller.
- The first-user-admin trigger remains unchanged and correct.
*/

-- Replace admin_list_users to filter by shared espaces
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id uuid,
  nom varchar,
  email varchar,
  role varchar,
  langue varchar,
  actif boolean,
  cree_le timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only return users who share at least one espace with the caller
  RETURN QUERY
  SELECT p.id, p.nom, p.email, p.role, p.langue, p.actif, p.cree_le
  FROM public.profiles p
  WHERE EXISTS (
    SELECT 1
    FROM public.user_espaces ue_caller
    JOIN public.user_espaces ue_target ON ue_target.espace_id = ue_caller.espace_id
    WHERE ue_caller.user_id = auth.uid()
      AND ue_target.user_id = p.id
  )
  ORDER BY p.cree_le DESC;
END;
$$;
