/*
# Revoke public EXECUTE on SECURITY DEFINER functions

## Problem
Even after revoking EXECUTE from anon, the `public` role still grants
EXECUTE to everyone. Need to revoke from public and only grant to authenticated.

## Changes
- REVOKE EXECUTE ON ALL SECURITY DEFINER FUNCTIONS FROM PUBLIC
- GRANT EXECUTE only to authenticated
*/

-- Trigger functions (internal, no direct call needed)
REVOKE EXECUTE ON FUNCTION public.fn_handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_first_user_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_auto_validation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_transactions_audit() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_transactions_set_espace() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_audit_set_espace() FROM PUBLIC;

-- App-facing RPCs
REVOKE EXECUTE ON FUNCTION public._check_can_view_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_update_user(uuid, varchar, boolean, varchar, varchar) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_espace(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_espace(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reset_espace(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_historique_solde(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_historique_solde(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_solde_total() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_solde_total(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_solde_utilisateur(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_solde_utilisateur(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_stats_mensuelles(varchar) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_stats_mensuelles(varchar, uuid) FROM PUBLIC;

-- Grant only to authenticated
GRANT EXECUTE ON FUNCTION public._check_can_view_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, varchar, boolean, varchar, varchar) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_espace(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_espace(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_espace(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_historique_solde(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_historique_solde(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_solde_total() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_solde_total(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_solde_utilisateur(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_solde_utilisateur(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stats_mensuelles(varchar) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stats_mensuelles(varchar, uuid) TO authenticated;
