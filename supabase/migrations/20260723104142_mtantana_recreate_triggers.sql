-- Recreate the audit and validation triggers that were dropped during migration
CREATE TRIGGER transactions_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.fn_transactions_audit();

CREATE TRIGGER transactions_auto_validation
BEFORE INSERT OR UPDATE OF montant, statut ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.fn_auto_validation();
