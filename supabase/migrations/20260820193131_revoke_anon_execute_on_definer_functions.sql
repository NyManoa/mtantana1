/*
# Revoke anon EXECUTE on SECURITY DEFINER functions

## Problem
Several SECURITY DEFINER functions were callable by the `anon` role,
meaning unauthenticated users could invoke them.

## Changes
- Revoke EXECUTE from anon on all SECURITY DEFINER functions
- Grant EXECUTE to authenticated only (for the ones the app needs)
*/

REVOKE EXECUTE ON FUNCTION public._check_can_view_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_user(uuid, varchar, boolean, varchar, varchar) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_first_user_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_auto_validation() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_transactions_audit() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_transactions_set_espace() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_audit_set_espace() FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_espace(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_espace(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reset_espace(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_historique_solde(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_historique_solde(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_solde_total() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_solde_total(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_solde_utilisateur(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_solde_utilisateur(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_stats_mensuelles(varchar) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_stats_mensuelles(varchar, uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public._check_can_view_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, varchar, boolean, varchar, varchar) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_historique_solde(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_historique_solde(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_solde_total() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_solde_total(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_solde_utilisateur(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_solde_utilisateur(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stats_mensuelles(varchar) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stats_mensuelles(varchar, uuid) TO authenticated;
