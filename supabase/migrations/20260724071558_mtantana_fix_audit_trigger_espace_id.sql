/*
# Fix: audit trigger should set espace_id on journal_audit rows

## Problem
The fn_transactions_audit trigger inserts into journal_audit without
setting espace_id, so audit entries for transactions don't have an
espace_id. This means they're invisible to the RLS policy that filters
by espace membership.

## Solution
Set espace_id from the transaction being audited.
*/

CREATE OR REPLACE FUNCTION public.fn_transactions_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_old jsonb;
  v_new jsonb;
  v_action varchar(20);
  v_tx_id uuid;
  v_espace_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_action := 'suppression';
    v_tx_id := NULL;
    v_new := NULL;
    v_espace_id := OLD.espace_id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_action := 'modification';
    v_tx_id := NEW.id;
    v_espace_id := NEW.espace_id;
  ELSE -- INSERT
    v_old := NULL;
    v_new := to_jsonb(NEW);
    v_action := 'creation';
    v_tx_id := NEW.id;
    v_espace_id := NEW.espace_id;
  END IF;

  INSERT INTO public.journal_audit (transaction_id, utilisateur_id, action, ancienne_valeur, nouvelle_valeur, espace_id)
  VALUES (v_tx_id, v_user, v_action, v_old, v_new, v_espace_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;
