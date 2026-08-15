BEGIN;

-- SECURITY DEFINER functions are intentionally used for transaction-safe ledger writes.
-- Remove PostgreSQL's default PUBLIC execution grant and expose only the client RPCs
-- that authenticated, current-device sessions are allowed to call.
REVOKE EXECUTE ON FUNCTION public.auto_confirm_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prepare_member_payment_details() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_member_payment_record() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_monthly_due_balance(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_monthly_due_from_allocation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_voucher_number(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.require_active_ledger_session() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.claim_active_session(boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.heartbeat_active_session() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.release_active_session() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_current_device_session() FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.bulk_import_members(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_member_dues(text, text, numeric, integer, integer, boolean, text, numeric, date, text, text, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_member_payment(uuid, numeric, date, text, text, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_monthly_due(uuid, text, text, numeric, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_monthly_due(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_monthly_due_detail(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_ledger_members() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_ledger_payments() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_ledger_dashboard_summary(integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_payment_receipt(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.claim_active_session(boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_active_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_active_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_current_device_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_import_members(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_member_dues(text, text, numeric, integer, integer, boolean, text, numeric, date, text, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_member_payment(uuid, numeric, date, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_monthly_due(uuid, text, text, numeric, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_monthly_due(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_monthly_due_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ledger_members() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ledger_payments() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ledger_dashboard_summary(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_payment_receipt(uuid) TO authenticated;

COMMIT;
