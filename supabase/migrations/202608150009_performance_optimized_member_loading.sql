-- Performance-only optimization: preserve all ledger behavior while avoiding account-wide
-- member payloads for dashboard work and avoiding a post-create member-detail round trip.

CREATE OR REPLACE FUNCTION public.get_ledger_members(
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
  IF (p_month IS NULL) <> (p_year IS NULL) THEN
    RAISE EXCEPTION 'Month and year must be supplied together.';
  END IF;
  IF p_month IS NOT NULL AND p_month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Month must be between 1 and 12.';
  END IF;
  IF p_year IS NOT NULL AND p_year NOT BETWEEN 2000 AND 2100 THEN
    RAISE EXCEPTION 'Year must be between 2000 and 2100.';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(member_row) ORDER BY member_row.created_at DESC)
    FROM (
      SELECT m.id, m.name, m.phone, m.amount, m.amount_paid, m.amount_pending, m.status,
             m.month, m.year, m.hold, m.member_identity_id, m.created_at, m.updated_at,
             COALESCE((
               SELECT latest_payment.payment_method
               FROM public.payment_allocations a
               JOIN public.payments latest_payment ON latest_payment.id = a.payment_id
               WHERE a.monthly_due_id = m.id
               ORDER BY latest_payment.payment_date DESC, latest_payment.created_at DESC
               LIMIT 1
             ), m.payment_mode) AS payment_mode,
             COALESCE((
               SELECT latest_payment.payment_date
               FROM public.payment_allocations a
               JOIN public.payments latest_payment ON latest_payment.id = a.payment_id
               WHERE a.monthly_due_id = m.id
               ORDER BY latest_payment.payment_date DESC, latest_payment.created_at DESC
               LIMIT 1
             ), m.payment_date) AS payment_date,
             COALESCE((
               SELECT latest_payment.voucher_number
               FROM public.payment_allocations a
               JOIN public.payments latest_payment ON latest_payment.id = a.payment_id
               WHERE a.monthly_due_id = m.id
               ORDER BY latest_payment.payment_date DESC, latest_payment.created_at DESC
               LIMIT 1
             ), m.voucher_number) AS voucher_number,
             (
               SELECT COUNT(*)::integer
               FROM public.members sibling
               WHERE sibling.member_identity_id = m.member_identity_id
                 AND sibling.deleted_at IS NULL
                 AND sibling.amount_pending > 0
             ) AS months_pending,
             (
               SELECT COALESCE(SUM(sibling.amount_pending), 0)
               FROM public.members sibling
               WHERE sibling.member_identity_id = m.member_identity_id
                 AND sibling.deleted_at IS NULL
             ) AS total_pending_amount
      FROM public.members m
      WHERE m.user_id = v_user_id
        AND m.deleted_at IS NULL
        AND (p_month IS NULL OR (m.month = p_month AND m.year = p_year))
    ) member_row
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_member_dues(
  p_name text,
  p_phone text,
  p_amount numeric,
  p_month integer,
  p_year integer,
  p_all_months boolean DEFAULT false,
  p_initial_status text DEFAULT 'unpaid',
  p_payment_amount numeric DEFAULT 0,
  p_payment_date date DEFAULT NULL,
  p_payment_method text DEFAULT 'cash',
  p_voucher_number text DEFAULT NULL,
  p_hold boolean DEFAULT false,
  p_notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := public.require_active_ledger_session();
  v_identity_id uuid;
  v_due_id uuid;
  v_anchor_due_id uuid;
  v_created_due_id uuid;
  v_month integer;
  v_created_count integer := 0;
  v_skipped_count integer := 0;
  v_created_ids jsonb := '[]'::jsonb;
  v_created_due jsonb := NULL;
  v_payment jsonb := NULL;
  v_status text := lower(btrim(COALESCE(p_initial_status, 'unpaid')));
BEGIN
  IF btrim(COALESCE(p_name, '')) = '' THEN RAISE EXCEPTION 'Member name is required.'; END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN RAISE EXCEPTION 'Monthly amount must be zero or greater.'; END IF;
  IF p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2100 THEN RAISE EXCEPTION 'Year must be between 2000 and 2100.'; END IF;
  IF NOT p_all_months AND (p_month IS NULL OR p_month NOT BETWEEN 1 AND 12) THEN RAISE EXCEPTION 'Month must be between 1 and 12.'; END IF;
  IF v_status NOT IN ('unpaid', 'pending', 'paid', 'partial') THEN RAISE EXCEPTION 'Invalid initial contribution status.'; END IF;
  IF p_payment_amount IS NULL OR p_payment_amount < 0 THEN RAISE EXCEPTION 'Payment amount must be zero or greater.'; END IF;
  IF p_payment_method NOT IN ('cash', 'account') THEN RAISE EXCEPTION 'Payment mode must be cash or account.'; END IF;

  SELECT id INTO v_identity_id
  FROM public.member_identities
  WHERE user_id = v_user_id
    AND lower(name) = lower(btrim(p_name))
    AND lower(phone) = lower(btrim(COALESCE(p_phone, '')))
  LIMIT 1
  FOR UPDATE;

  IF v_identity_id IS NULL THEN
    INSERT INTO public.member_identities (user_id, name, phone)
    VALUES (v_user_id, btrim(p_name), btrim(COALESCE(p_phone, '')))
    RETURNING id INTO v_identity_id;
  END IF;

  FOR v_month IN SELECT value FROM unnest(CASE WHEN p_all_months THEN ARRAY[1,2,3,4,5,6,7,8,9,10,11,12] ELSE ARRAY[p_month] END) value
  LOOP
    INSERT INTO public.members (
      user_id, member_identity_id, name, phone, amount, status, payment_mode,
      month, year, hold, months_pending, amount_paid, amount_pending,
      payment_date, voucher_number, legacy_review_required
    ) VALUES (
      v_user_id, v_identity_id, btrim(p_name), btrim(COALESCE(p_phone, '')), p_amount,
      CASE WHEN p_payment_amount > 0 THEN 'pending' ELSE CASE WHEN v_status IN ('paid', 'partial') THEN 'pending' ELSE v_status END END,
      p_payment_method, v_month, p_year, COALESCE(p_hold, false), 0, 0, p_amount,
      NULL, NULL, false
    )
    ON CONFLICT (user_id, member_identity_id, month, year) DO NOTHING
    RETURNING id INTO v_due_id;

    IF v_due_id IS NULL THEN
      v_skipped_count := v_skipped_count + 1;
      SELECT id INTO v_anchor_due_id
      FROM public.members
      WHERE user_id = v_user_id
        AND member_identity_id = v_identity_id
        AND month = v_month
        AND year = p_year
      LIMIT 1;
    ELSE
      v_created_count := v_created_count + 1;
      v_created_ids := v_created_ids || jsonb_build_array(v_due_id);
      v_created_due_id := COALESCE(v_created_due_id, v_due_id);
      v_anchor_due_id := COALESCE(v_anchor_due_id, v_due_id);
    END IF;
  END LOOP;

  IF p_payment_amount > 0 THEN
    IF v_anchor_due_id IS NULL THEN
      RAISE EXCEPTION 'No contribution period is available for this payment.';
    END IF;
    v_payment := public.record_member_payment(
      v_anchor_due_id, p_payment_amount, COALESCE(p_payment_date, current_date),
      p_payment_method, p_voucher_number, p_notes, NULL
    );
  END IF;

  IF NOT p_all_months AND v_created_due_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', m.id,
      'member_identity_id', m.member_identity_id,
      'name', m.name,
      'phone', m.phone,
      'amount', m.amount,
      'amount_paid', m.amount_paid,
      'amount_pending', m.amount_pending,
      'total_pending_amount', COALESCE((
        SELECT SUM(sibling.amount_pending)
        FROM public.members sibling
        WHERE sibling.member_identity_id = m.member_identity_id
          AND sibling.deleted_at IS NULL
      ), 0),
      'status', m.status,
      'payment_mode', COALESCE((
        SELECT latest_payment.payment_method
        FROM public.payment_allocations allocation
        JOIN public.payments latest_payment ON latest_payment.id = allocation.payment_id
        WHERE allocation.monthly_due_id = m.id
        ORDER BY latest_payment.payment_date DESC, latest_payment.created_at DESC
        LIMIT 1
      ), m.payment_mode),
      'month', m.month,
      'year', m.year,
      'hold', m.hold,
      'months_pending', COALESCE((
        SELECT COUNT(*)
        FROM public.members sibling
        WHERE sibling.member_identity_id = m.member_identity_id
          AND sibling.deleted_at IS NULL
          AND sibling.amount_pending > 0
      ), 0),
      'payment_date', COALESCE((
        SELECT latest_payment.payment_date
        FROM public.payment_allocations allocation
        JOIN public.payments latest_payment ON latest_payment.id = allocation.payment_id
        WHERE allocation.monthly_due_id = m.id
        ORDER BY latest_payment.payment_date DESC, latest_payment.created_at DESC
        LIMIT 1
      ), m.payment_date),
      'voucher_number', COALESCE((
        SELECT latest_payment.voucher_number
        FROM public.payment_allocations allocation
        JOIN public.payments latest_payment ON latest_payment.id = allocation.payment_id
        WHERE allocation.monthly_due_id = m.id
        ORDER BY latest_payment.payment_date DESC, latest_payment.created_at DESC
        LIMIT 1
      ), m.voucher_number),
      'legacy_review_required', m.legacy_review_required,
      'created_at', m.created_at,
      'updated_at', m.updated_at
    )
    INTO v_created_due
    FROM public.members m
    WHERE m.id = v_created_due_id
      AND m.user_id = v_user_id
      AND m.deleted_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'member_identity_id', v_identity_id,
    'created_count', v_created_count,
    'skipped_count', v_skipped_count,
    'created_due_ids', v_created_ids,
    'created_due', v_created_due,
    'payment', v_payment
  );
END;
$$;
