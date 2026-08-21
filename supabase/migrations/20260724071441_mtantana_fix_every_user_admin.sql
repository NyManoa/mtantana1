/*
# Fix: every new user is admin of their own espace

## Problem
The fn_first_user_admin trigger only made the very first user an admin.
All subsequent users got "operateur" role. But the user wants every
account to be admin so they can manage users and roles.

## Solution
Remove the first-user-only logic. Every new user gets "admin" role
by default. The admin can then downgrade users to operateur/superviseur
via the Users page.
*/

CREATE OR REPLACE FUNCTION public.fn_first_user_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  -- Every new user is admin of their own espace by default.
  -- Admins can downgrade individual users to operateur/superviseur later.
  NEW.role := 'admin';
  RETURN NEW;
END;
$$;
