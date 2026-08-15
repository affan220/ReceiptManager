BEGIN;

-- One account-scoped summary is the source of truth for dashboard, reports,
-- exports, and print output. It derives all totals from actual payment and Other
-- transactions, never from a stored aggregate, so edits and deletes cannot leave
-- stale or duplicate collection values behind.
CREATE OR REPLACE FUNCTION public.get_accounting_summary(
  p_month integer DEFAULT NULL,
  p_year integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user_id uuid := public.require_active_ledger_session();
BEGIN
  IF p_month IS NOT NULL AND p_month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Month must be between 1 and 12.';
  END IF;
  IF p_year IS NOT NULL AND p_year NOT BETWEEN 2000 AND 2100 THEN
    RAISE EXCEPTION 'Year must be between 2000 and 2100.';
  END IF;

  RETURN (
    WITH selected_dues AS (
      SELECT *
      FROM public.members m
      WHERE m.user_id = v_user_id
        AND m.deleted_at IS NULL
        AND (p_month IS NULL OR m.month = p_month)
        AND (p_year IS NULL OR m.year = p_year)
    ), period_member_payments AS (
      SELECT *
      FROM public.payments p
      WHERE p.user_id = v_user_id
        AND (p_month IS NULL OR EXTRACT(MONTH FROM p.payment_date)::integer = p_month)
        AND (p_year IS NULL OR EXTRACT(YEAR FROM p.payment_date)::integer = p_year)
    ), year_member_payments AS (
      SELECT *
      FROM public.payments p
      WHERE p.user_id = v_user_id
        AND (p_year IS NULL OR EXTRACT(YEAR FROM p.payment_date)::integer = p_year)
    ), period_fridays AS (
      SELECT *
      FROM public.friday_collections f
      WHERE f.user_id = v_user_id
        AND (p_month IS NULL OR EXTRACT(MONTH FROM f.collection_date)::integer = p_month)
        AND (p_year IS NULL OR EXTRACT(YEAR FROM f.collection_date)::integer = p_year)
    ), year_fridays AS (
      SELECT *
      FROM public.friday_collections f
      WHERE f.user_id = v_user_id
        AND (p_year IS NULL OR EXTRACT(YEAR FROM f.collection_date)::integer = p_year)
    ), period_rents AS (
      SELECT *
      FROM public.room_rents r
      WHERE r.user_id = v_user_id
        AND (p_month IS NULL OR EXTRACT(MONTH FROM r.rent_date)::integer = p_month)
        AND (p_year IS NULL OR EXTRACT(YEAR FROM r.rent_date)::integer = p_year)
    ), year_rents AS (
      SELECT *
      FROM public.room_rents r
      WHERE r.user_id = v_user_id
        AND (p_year IS NULL OR EXTRACT(YEAR FROM r.rent_date)::integer = p_year)
    ), totals AS (
      SELECT
        COALESCE((SELECT SUM(amount) FROM period_member_payments), 0) AS member_monthly,
        COALESCE((SELECT SUM(amount) FROM year_member_payments), 0) AS member_yearly,
        COALESCE((SELECT SUM(amount) FROM period_fridays), 0) AS friday_monthly,
        COALESCE((SELECT SUM(amount) FROM period_rents), 0) AS rent_monthly,
        COALESCE((SELECT SUM(amount) FROM year_fridays), 0) AS friday_yearly,
        COALESCE((SELECT SUM(amount) FROM year_rents), 0) AS rent_yearly,
        COALESCE((SELECT SUM(amount) FROM period_member_payments WHERE payment_method = 'cash'), 0) AS member_cash,
        COALESCE((SELECT SUM(amount) FROM period_member_payments WHERE payment_method = 'account'), 0) AS member_account,
        COALESCE((SELECT SUM(amount) FROM period_fridays WHERE payment_mode = 'cash'), 0) + COALESCE((SELECT SUM(amount) FROM period_rents WHERE payment_mode = 'cash'), 0) AS other_cash,
        COALESCE((SELECT SUM(amount) FROM period_fridays WHERE payment_mode = 'account'), 0) + COALESCE((SELECT SUM(amount) FROM period_rents WHERE payment_mode = 'account'), 0) AS other_account
    )
    SELECT jsonb_build_object(
      'total', (SELECT COUNT(*) FROM selected_dues),
      'paid', (SELECT COUNT(*) FROM selected_dues WHERE status = 'paid'),
      'unpaid', (SELECT COUNT(*) FROM selected_dues WHERE status = 'unpaid'),
      'pending', (SELECT COUNT(*) FROM selected_dues WHERE status IN ('pending', 'partial')),
      'partial', (SELECT COUNT(*) FROM selected_dues WHERE status = 'partial'),
      'expected_dues', COALESCE((SELECT SUM(amount) FROM selected_dues), 0),
      'outstanding', COALESCE((SELECT SUM(amount_pending) FROM selected_dues), 0),
      'member_monthly_collection', member_monthly,
      'member_yearly_collection', member_yearly,
      'friday_collection', friday_monthly,
      'room_rent_collection', rent_monthly,
      'other_collection', friday_monthly + rent_monthly,
      'monthly_collection', member_monthly + friday_monthly + rent_monthly,
      'total_collection', member_monthly + friday_monthly + rent_monthly,
      'yearly_friday_collection', friday_yearly,
      'yearly_room_rent_collection', rent_yearly,
      'yearly_other_collection', friday_yearly + rent_yearly,
      'yearly_collection', member_yearly + friday_yearly + rent_yearly,
      'yearly_total_collection', member_yearly + friday_yearly + rent_yearly,
      'member_cash_received', member_cash,
      'member_account_received', member_account,
      'other_cash_received', other_cash,
      'other_account_received', other_account,
      'cash_received', member_cash + other_cash,
      'account_received', member_account + other_account,
      'collection_percent', CASE
        WHEN COALESCE((SELECT SUM(amount) FROM selected_dues), 0) = 0 THEN 0
        ELSE ROUND((member_monthly / (SELECT SUM(amount) FROM selected_dues)) * 100, 2)
      END
    )
    FROM totals
  );
END;
$$;

-- Preserve the existing RPC contract while routing it through the shared accounting source.
CREATE OR REPLACE FUNCTION public.get_ledger_dashboard_summary(
  p_month integer DEFAULT NULL,
  p_year integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_accounting_summary(p_month, p_year);
$$;

REVOKE ALL ON FUNCTION public.get_accounting_summary(integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_ledger_dashboard_summary(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_accounting_summary(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ledger_dashboard_summary(integer, integer) TO authenticated;

COMMIT;
