/*
# Auto-admin du premier utilisateur

## Contexte
Au signup, tout nouvel utilisateur est créé avec le rôle "operateur" par défaut.
Aucun admin n'existe alors pour le promouvoir, ce qui bloque l'accès aux fonctions
d'administration (journal d'audit, gestion des utilisateurs).

## Solution
Un trigger BEFORE INSERT sur `public.profiles` : si la table est vide (première
inscription), le rôle est forcé à "admin". Les inscriptions suivantes conservent
le rôle fourni (operateur par défaut).

## Sécurité
- Fonction SECURITY DEFINER, search_path = public.
- Aucune modification des policies existantes.
- Idempotent : le trigger ne s'active que sur INSERT, et la condition
  `SELECT count(*) = 0` n'est vraie qu'une seule fois.
*/

CREATE OR REPLACE FUNCTION public.fn_first_user_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

DROP TRIGGER IF EXISTS profiles_first_user_admin ON public.profiles;
CREATE TRIGGER profiles_first_user_admin
BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.fn_first_user_admin();
