-- Fix audit trigger: on DELETE, the transaction row is already gone, so inserting
-- journal_audit with transaction_id = OLD.id causes FK violation.
-- Set transaction_id to NULL on DELETE to avoid the constraint violation.
CREATE OR REPLACE FUNCTION public.fn_transactions_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_old jsonb;
  v_new jsonb;
  v_action varchar(20);
  v_tx_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_action := 'suppression';
    v_tx_id := NULL; -- FK to transactions would fail since the row is being deleted
    v_new := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_action := 'modification';
    v_tx_id := NEW.id;
  ELSE -- INSERT
    v_old := NULL;
    v_new := to_jsonb(NEW);
    v_action := 'creation';
    v_tx_id := NEW.id;
  END IF;

  INSERT INTO public.journal_audit (transaction_id, utilisateur_id, action, ancienne_valeur, nouvelle_valeur)
  VALUES (v_tx_id, v_user, v_action, v_old, v_new);

  RETURN COALESCE(NEW, OLD);
END;
$$;
