/*
# Fix signup: auto-create profile + default espace for first admin

## Problem
The `signUp` function in the frontend manually inserts a profile row after
`supabase.auth.signUp()`. This creates a race condition: the `onAuthStateChange`
callback fires and tries to `loadProfile()` before the profile row exists,
so the profile is null, the user appears as non-admin, and the EspaceGuard
shows "no espace" without the create form.

Additionally, when the first user signs up (auto-admin), they get no default
espace, so they're stuck on the "no espace" screen.

## Solution
1. Create a trigger `on_auth_user_created` on `auth.users` that auto-inserts
   a profile row using `raw_user_meta_data` for nom/role/langue. This eliminates
   the race condition — the profile exists before the frontend ever tries to
   load it.

2. The existing `fn_first_user_admin` trigger on `profiles` will override the
   role to 'admin' for the first user.

3. After the profile is created, if the user is an admin AND has no espaces,
   auto-create a default espace named "Principal" and assign them as admin.

## Security
- The trigger function is SECURITY DEFINER with search_path = public.
- No changes to existing RLS policies.
- The first-user-admin trigger remains unchanged.
*/

-- Function to handle new auth user: create profile + default espace for first admin
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
BEGIN
  -- Extract metadata from the user's raw_user_meta_data
  v_nom := COALESCE(NEW.raw_user_meta_data->>'nom', split_part(NEW.email, '@', 1));
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'operateur');
  v_langue := COALESCE(NEW.raw_user_meta_data->>'langue', 'fr');

  -- Insert profile (fn_first_user_admin trigger will override role if first user)
  INSERT INTO public.profiles (id, nom, email, role, langue, actif)
  VALUES (NEW.id, v_nom, NEW.email, v_role, v_langue, true)
  ON CONFLICT (id) DO NOTHING;

  -- Check if this is the first user (admin) and create a default espace
  SELECT count(*) INTO v_profile_count FROM public.profiles;
  
  IF v_profile_count = 1 THEN
    -- This is the first user (admin) — create a default espace
    INSERT INTO public.espaces (nom, cree_par)
    VALUES ('Principal', NEW.id)
    RETURNING id INTO v_espace_id;

    -- Assign the first user as admin of the default espace
    INSERT INTO public.user_espaces (user_id, espace_id, role_dans_espace)
    VALUES (NEW.id, v_espace_id, 'admin')
    ON CONFLICT (user_id, espace_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT INSERT ON public.profiles TO supabase_auth_admin;
GRANT INSERT ON public.espaces TO supabase_auth_admin;
GRANT INSERT ON public.user_espaces TO supabase_auth_admin;
GRANT SELECT ON public.profiles TO supabase_auth_admin;
