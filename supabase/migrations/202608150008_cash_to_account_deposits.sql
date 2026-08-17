BEGIN;

-- Deposits are transfer transactions, not income. The accounting period is stored
-- separately from the actual bank-deposit date so late deposits can be attributed
-- to the cash period they reconcile.
CREATE TABLE IF NOT EXISTS public.deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  deposit_date date NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deposits_user_period_date_idx
  ON public.deposits (user_id, year, month, deposit_date DESC);

DROP TRIGGER IF EXISTS deposits_touch_updated_at ON public.deposits;
CREATE TRIGGER deposits_touch_updated_at
BEFORE UPDATE ON public.deposits
FOR EACH ROW EXECUTE FUNCTION public.touch_other_income_updated_at();

ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own deposits" ON public.deposits;
CREATE POLICY "Users view own deposits" ON public.deposits
  FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Active device required for deposits" ON public.deposits;
CREATE POLICY "Active device required for deposits" ON public.deposits
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((select public.is_current_device_session()))
  WITH CHECK ((select public.is_current_device_session()));
REVOKE ALL ON public.deposits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.deposits TO authenticated;

-- Internal calculation used by all deposit procedures. It deliberately includes
-- only actual cash income from member payments, Friday collections, and room rents.
-- Deposits themselves are excluded because they are a location transfer, not income.
CREATE OR REPLACE FUNCTION public.get_cash_income_for_period(
  p_user_id uuid,
  p_month integer,
  p_year integer
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT SUM(p.amount)
      FROM public.payments p
      WHERE p.user_id = p_user_id
        AND p.payment_method = 'cash'
        AND EXTRACT(MONTH FROM p.payment_date)::integer = p_month
        AND EXTRACT(YEAR FROM p.payment_date)::integer = p_year
    ), 0)
    + COALESCE((
      SELECT SUM(f.amount)
      FROM public.friday_collections f
      WHERE f.user_id = p_user_id
        AND f.payment_mode = 'cash'
        AND EXTRACT(MONTH FROM f.collection_date)::integer = p_month
        AND EXTRACT(YEAR FROM f.collection_date)::integer = p_year
    ), 0)
    + COALESCE((
      SELECT SUM(r.amount)
      FROM public.room_rents r
      WHERE r.user_id = p_user_id
        AND r.payment_mode = 'cash'
        AND EXTRACT(MONTH FROM r.rent_date)::integer = p_month
        AND EXTRACT(YEAR FROM r.rent_date)::integer = p_year
    ), 0);
$$;

CREATE OR REPLACE FUNCTION public.get_deposit_summary(
  p_month integer,
  p_year integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := public.require_active_ledger_session();
  v_cash_income numeric;
  v_deposited numeric;
  v_rows jsonb;
BEGIN
  IF p_month IS NULL OR p_month NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Month must be between 1 and 12.'; END IF;
  IF p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2100 THEN RAISE EXCEPTION 'Year must be between 2000 and 2100.'; END IF;

  v_cash_income := public.get_cash_income_for_period(v_user_id, p_month, p_year);
  SELECT COALESCE(SUM(amount), 0), COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'month', month,
    'year', year,
    'deposit_date', deposit_date,
    'amount', amount,
    'notes', notes,
    'created_at', created_at,
    'updated_at', updated_at
  ) ORDER BY deposit_date DESC, created_at DESC), '[]'::jsonb)
  INTO v_deposited, v_rows
  FROM public.deposits
  WHERE user_id = v_user_id
    AND month = p_month
    AND year = p_year;

  RETURN jsonb_build_object(
    'deposits', v_rows,
    'cash_income', v_cash_income,
    'total_deposited', v_deposited,
    'available_cash', GREATEST(v_cash_income - v_deposited, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_deposit(
  p_month integer,
  p_year integer,
  p_deposit_date date,
  p_amount numeric,
  p_notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := public.require_active_ledger_session();
  v_cash_income numeric;
  v_existing_deposits numeric;
  v_available numeric;
  v_created public.deposits%ROWTYPE;
BEGIN
  IF p_month IS NULL OR p_month NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Month must be between 1 and 12.'; END IF;
  IF p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2100 THEN RAISE EXCEPTION 'Year must be between 2000 and 2100.'; END IF;
  IF p_deposit_date IS NULL THEN RAISE EXCEPTION 'Deposit date is required.'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Deposit amount must be greater than zero.'; END IF;

  -- Serialize all deposit writes for an account so concurrent devices cannot overdraw cash.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':deposit-transfer', 0));
  v_cash_income := public.get_cash_income_for_period(v_user_id, p_month, p_year);
  SELECT COALESCE(SUM(amount), 0) INTO v_existing_deposits
  FROM public.deposits
  WHERE user_id = v_user_id AND month = p_month AND year = p_year;
  v_available := v_cash_income - v_existing_deposits;

  IF p_amount > v_available THEN
    RAISE EXCEPTION 'Insufficient cash balance. Available cash for the selected period is %.', GREATEST(v_available, 0);
  END IF;

  INSERT INTO public.deposits (user_id, month, year, deposit_date, amount, notes)
  VALUES (v_user_id, p_month, p_year, p_deposit_date, p_amount, COALESCE(p_notes, ''))
  RETURNING * INTO v_created;

  RETURN jsonb_build_object(
    'id', v_created.id, 'month', v_created.month, 'year', v_created.year,
    'deposit_date', v_created.deposit_date, 'amount', v_created.amount,
    'notes', v_created.notes, 'created_at', v_created.created_at, 'updated_at', v_created.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_deposit(
  p_deposit_id uuid,
  p_month integer,
  p_year integer,
  p_deposit_date date,
  p_amount numeric,
  p_notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := public.require_active_ledger_session();
  v_existing public.deposits%ROWTYPE;
  v_cash_income numeric;
  v_other_deposits numeric;
  v_available numeric;
  v_updated public.deposits%ROWTYPE;
BEGIN
  IF p_month IS NULL OR p_month NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Month must be between 1 and 12.'; END IF;
  IF p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2100 THEN RAISE EXCEPTION 'Year must be between 2000 and 2100.'; END IF;
  IF p_deposit_date IS NULL THEN RAISE EXCEPTION 'Deposit date is required.'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Deposit amount must be greater than zero.'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':deposit-transfer', 0));
  SELECT * INTO v_existing FROM public.deposits
  WHERE id = p_deposit_id AND user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deposit record was not found.'; END IF;

  v_cash_income := public.get_cash_income_for_period(v_user_id, p_month, p_year);
  SELECT COALESCE(SUM(amount), 0) INTO v_other_deposits
  FROM public.deposits
  WHERE user_id = v_user_id
    AND month = p_month
    AND year = p_year
    AND id <> p_deposit_id;
  v_available := v_cash_income - v_other_deposits;
  IF p_amount > v_available THEN
    RAISE EXCEPTION 'Insufficient cash balance. Available cash for the selected period is %.', GREATEST(v_available, 0);
  END IF;

  UPDATE public.deposits
  SET month = p_month, year = p_year, deposit_date = p_deposit_date,
      amount = p_amount, notes = COALESCE(p_notes, '')
  WHERE id = p_deposit_id
  RETURNING * INTO v_updated;

  RETURN jsonb_build_object(
    'id', v_updated.id, 'month', v_updated.month, 'year', v_updated.year,
    'deposit_date', v_updated.deposit_date, 'amount', v_updated.amount,
    'notes', v_updated.notes, 'created_at', v_updated.created_at, 'updated_at', v_updated.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_deposit(p_deposit_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user_id uuid := public.require_active_ledger_session();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':deposit-transfer', 0));
  DELETE FROM public.deposits
  WHERE id = p_deposit_id AND user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deposit record was not found.'; END IF;
END;
$$;

-- Extend the shared database accounting source. Deposits reclassify money only:
-- they reduce cash and increase account by the same amount, leaving income totals
-- and collection percentages exactly unchanged.
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
  IF p_month IS NOT NULL AND p_month NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Month must be between 1 and 12.'; END IF;
  IF p_year IS NOT NULL AND p_year NOT BETWEEN 2000 AND 2100 THEN RAISE EXCEPTION 'Year must be between 2000 and 2100.'; END IF;

  RETURN (
    WITH selected_dues AS (
      SELECT * FROM public.members m WHERE m.user_id = v_user_id AND m.deleted_at IS NULL
        AND (p_month IS NULL OR m.month = p_month) AND (p_year IS NULL OR m.year = p_year)
    ), period_member_payments AS (
      SELECT * FROM public.payments p WHERE p.user_id = v_user_id
        AND (p_month IS NULL OR EXTRACT(MONTH FROM p.payment_date)::integer = p_month)
        AND (p_year IS NULL OR EXTRACT(YEAR FROM p.payment_date)::integer = p_year)
    ), year_member_payments AS (
      SELECT * FROM public.payments p WHERE p.user_id = v_user_id
        AND (p_year IS NULL OR EXTRACT(YEAR FROM p.payment_date)::integer = p_year)
    ), period_fridays AS (
      SELECT * FROM public.friday_collections f WHERE f.user_id = v_user_id
        AND (p_month IS NULL OR EXTRACT(MONTH FROM f.collection_date)::integer = p_month)
        AND (p_year IS NULL OR EXTRACT(YEAR FROM f.collection_date)::integer = p_year)
    ), year_fridays AS (
      SELECT * FROM public.friday_collections f WHERE f.user_id = v_user_id
        AND (p_year IS NULL OR EXTRACT(YEAR FROM f.collection_date)::integer = p_year)
    ), period_rents AS (
      SELECT * FROM public.room_rents r WHERE r.user_id = v_user_id
        AND (p_month IS NULL OR EXTRACT(MONTH FROM r.rent_date)::integer = p_month)
        AND (p_year IS NULL OR EXTRACT(YEAR FROM r.rent_date)::integer = p_year)
    ), year_rents AS (
      SELECT * FROM public.room_rents r WHERE r.user_id = v_user_id
        AND (p_year IS NULL OR EXTRACT(YEAR FROM r.rent_date)::integer = p_year)
    ), period_deposits AS (
      SELECT * FROM public.deposits d WHERE d.user_id = v_user_id
        AND (p_month IS NULL OR d.month = p_month)
        AND (p_year IS NULL OR d.year = p_year)
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
        COALESCE((SELECT SUM(amount) FROM period_fridays WHERE payment_mode = 'account'), 0) + COALESCE((SELECT SUM(amount) FROM period_rents WHERE payment_mode = 'account'), 0) AS other_account,
        COALESCE((SELECT SUM(amount) FROM period_deposits), 0) AS deposited_total
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
      'cash_income_before_deposits', member_cash + other_cash,
      'account_income_before_deposits', member_account + other_account,
      'deposited_total', deposited_total,
      'cash_received', GREATEST(member_cash + other_cash - deposited_total, 0),
      'account_received', member_account + other_account + deposited_total,
      'collection_percent', CASE WHEN COALESCE((SELECT SUM(amount) FROM selected_dues), 0) = 0 THEN 0
        ELSE ROUND((member_monthly / (SELECT SUM(amount) FROM selected_dues)) * 100, 2) END
    ) FROM totals
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ledger_dashboard_summary(
  p_month integer DEFAULT NULL,
  p_year integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ SELECT public.get_accounting_summary(p_month, p_year); $$;

REVOKE ALL ON FUNCTION public.get_cash_income_for_period(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_deposit_summary(integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_deposit(integer, integer, date, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_deposit(uuid, integer, integer, date, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_deposit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_deposit_summary(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_deposit(integer, integer, date, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_deposit(uuid, integer, integer, date, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_deposit(uuid) TO authenticated;

COMMIT;
