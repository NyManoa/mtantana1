/*
# Fix: fn_transactions_set_espace should prefer the user's primary espace

## Problem
When a transaction is inserted without an explicit espace_id, the
trigger picks a random espace from the user's memberships. This can
assign the transaction to the wrong espace if the user belongs to
multiple.

## Solution
Prefer the user's first espace (by creation order). The import code
already sets espace_id explicitly, so this is just a safety net.
*/

CREATE OR REPLACE FUNCTION public.fn_transactions_set_espace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_espace_id uuid;
BEGIN
  IF NEW.espace_id IS NULL THEN
    SELECT ue.espace_id INTO v_espace_id
    FROM public.user_espaces ue
    JOIN public.espaces e ON e.id = ue.espace_id
    WHERE ue.user_id = NEW.auteur_id
    ORDER BY e.cree_le ASC
    LIMIT 1;
    IF v_espace_id IS NULL THEN
      SELECT id INTO v_espace_id FROM public.espaces ORDER BY cree_le ASC LIMIT 1;
    END IF;
    NEW.espace_id := v_espace_id;
  END IF;
  RETURN NEW;
END;
$$;
