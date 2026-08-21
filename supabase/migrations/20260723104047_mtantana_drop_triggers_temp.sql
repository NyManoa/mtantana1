-- Drop audit trigger temporarily for the migration backfill
DROP TRIGGER IF EXISTS transactions_audit_trigger ON public.transactions;
DROP TRIGGER IF EXISTS transactions_auto_validation ON public.transactions;
