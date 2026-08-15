BEGIN;

-- Indian mobile numbers are stored consistently for new and edited records. Existing
-- legacy values are deliberately left intact here because the pre-flight audit found
-- duplicate normalized identities; the client displays those values safely instead.
CREATE OR REPLACE FUNCTION public.normalize_indian_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE v_digits text := regexp_replace(COALESCE(btrim(p_phone), ''), '[^0-9]', '', 'g');
BEGIN
  IF v_digits ~ '^91[0-9]{10}$' THEN v_digits := substr(v_digits, 3); END IF;
  IF v_digits !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'Enter a valid 10-digit Indian mobile number.' USING ERRCODE = '22023';
  END IF;
  RETURN '+91 ' || v_digits;
END;
$$;

CREATE OR REPLACE FUNCTION public.phone_identity_key(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE v_digits text := regexp_replace(COALESCE(btrim(p_phone), ''), '[^0-9]', '', 'g');
BEGIN
  IF v_digits ~ '^91[0-9]{10}$' THEN v_digits := substr(v_digits, 3); END IF;
  IF v_digits ~ '^[0-9]{10}$' THEN RETURN '+91 ' || v_digits; END IF;
  RETURN lower(btrim(COALESCE(p_phone, '')));
END;
$$;

CREATE TABLE IF NOT EXISTS public.friday_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  collection_date date NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  payment_mode text NOT NULL DEFAULT 'cash' CHECK (payment_mode IN ('cash', 'account')),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friday_collections_user_date_unique UNIQUE (user_id, collection_date),
  CONSTRAINT friday_collections_must_be_friday CHECK (EXTRACT(ISODOW FROM collection_date) = 5)
);

CREATE TABLE IF NOT EXISTS public.room_rents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rent_date date NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  payment_mode text NOT NULL DEFAULT 'cash' CHECK (payment_mode IN ('cash', 'account')),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS friday_collections_user_date_idx ON public.friday_collections (user_id, collection_date);
CREATE INDEX IF NOT EXISTS friday_collections_user_mode_date_idx ON public.friday_collections (user_id, payment_mode, collection_date);
CREATE INDEX IF NOT EXISTS room_rents_user_date_idx ON public.room_rents (user_id, rent_date);
CREATE INDEX IF NOT EXISTS room_rents_user_mode_date_idx ON public.room_rents (user_id, payment_mode, rent_date);

CREATE OR REPLACE FUNCTION public.touch_other_income_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friday_collections_touch_updated_at ON public.friday_collections;
CREATE TRIGGER friday_collections_touch_updated_at
BEFORE UPDATE ON public.friday_collections
FOR EACH ROW EXECUTE FUNCTION public.touch_other_income_updated_at();

DROP TRIGGER IF EXISTS room_rents_touch_updated_at ON public.room_rents;
CREATE TRIGGER room_rents_touch_updated_at
BEFORE UPDATE ON public.room_rents
FOR EACH ROW EXECUTE FUNCTION public.touch_other_income_updated_at();

ALTER TABLE public.friday_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_rents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own Friday collections" ON public.friday_collections;
CREATE POLICY "Users view own Friday collections" ON public.friday_collections
  FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Active device required for Friday collections" ON public.friday_collections;
CREATE POLICY "Active device required for Friday collections" ON public.friday_collections
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((select public.is_current_device_session()))
  WITH CHECK ((select public.is_current_device_session()));

DROP POLICY IF EXISTS "Users view own room rents" ON public.room_rents;
CREATE POLICY "Users view own room rents" ON public.room_rents
  FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Active device required for room rents" ON public.room_rents;
CREATE POLICY "Active device required for room rents" ON public.room_rents
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((select public.is_current_device_session()))
  WITH CHECK ((select public.is_current_device_session()));

REVOKE ALL ON public.friday_collections, public.room_rents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.friday_collections, public.room_rents TO authenticated;

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
  v_month integer;
  v_created_count integer := 0;
  v_skipped_count integer := 0;
  v_created_ids jsonb := '[]'::jsonb;
  v_payment jsonb := NULL;
  v_status text := lower(btrim(COALESCE(p_initial_status, 'unpaid')));
  v_phone text := public.normalize_indian_phone(p_phone);
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
    AND public.phone_identity_key(phone) = public.phone_identity_key(v_phone)
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;

  IF v_identity_id IS NULL THEN
    INSERT INTO public.member_identities (user_id, name, phone)
    VALUES (v_user_id, btrim(p_name), v_phone)
    RETURNING id INTO v_identity_id;
  END IF;

  FOR v_month IN SELECT value FROM unnest(CASE WHEN p_all_months THEN ARRAY[1,2,3,4,5,6,7,8,9,10,11,12] ELSE ARRAY[p_month] END) value
  LOOP
    v_due_id := NULL;
    INSERT INTO public.members (
      user_id, member_identity_id, name, phone, amount, status, payment_mode,
      month, year, hold, months_pending, amount_paid, amount_pending,
      payment_date, voucher_number, legacy_review_required
    ) VALUES (
      v_user_id, v_identity_id, btrim(p_name), v_phone, p_amount,
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
      WHERE user_id = v_user_id AND member_identity_id = v_identity_id AND month = v_month AND year = p_year
      LIMIT 1;
    ELSE
      v_created_count := v_created_count + 1;
      v_created_ids := v_created_ids || jsonb_build_array(v_due_id);
      v_anchor_due_id := COALESCE(v_anchor_due_id, v_due_id);
    END IF;
  END LOOP;

  IF p_payment_amount > 0 THEN
    IF v_anchor_due_id IS NULL THEN RAISE EXCEPTION 'No contribution period is available for this payment.'; END IF;
    v_payment := public.record_member_payment(v_anchor_due_id, p_payment_amount, COALESCE(p_payment_date, current_date), p_payment_method, p_voucher_number, p_notes, NULL);
  END IF;

  RETURN jsonb_build_object('member_identity_id', v_identity_id, 'created_count', v_created_count, 'skipped_count', v_skipped_count, 'created_due_ids', v_created_ids, 'payment', v_payment);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_monthly_due(
  p_due_member_id uuid,
  p_name text,
  p_phone text,
  p_amount numeric,
  p_hold boolean,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := public.require_active_ledger_session();
  v_due public.members%ROWTYPE;
  v_phone text := public.normalize_indian_phone(p_phone);
BEGIN
  IF btrim(COALESCE(p_name, '')) = '' THEN RAISE EXCEPTION 'Member name is required.'; END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN RAISE EXCEPTION 'Monthly amount must be zero or greater.'; END IF;
  IF p_status IS NOT NULL AND lower(btrim(p_status)) NOT IN ('unpaid', 'pending', 'paid', 'partial') THEN RAISE EXCEPTION 'Invalid contribution status.'; END IF;
  SELECT * INTO v_due FROM public.members WHERE id = p_due_member_id AND user_id = v_user_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Monthly contribution record was not found.'; END IF;
  IF p_amount < v_due.amount_paid THEN RAISE EXCEPTION 'Monthly amount cannot be reduced below the amount already allocated to this due.'; END IF;
  IF v_due.amount_paid > 0 AND p_status IS NOT NULL AND lower(btrim(p_status)) NOT IN ('paid', 'partial') THEN RAISE EXCEPTION 'A due with recorded payments cannot be changed back to unpaid or pending. Record a correcting payment instead.'; END IF;

  UPDATE public.members
  SET name = btrim(p_name), phone = v_phone, amount = p_amount, hold = COALESCE(p_hold, false),
      status = CASE WHEN amount_paid > 0 THEN status WHEN p_status IS NOT NULL THEN lower(btrim(p_status)) ELSE status END
  WHERE id = p_due_member_id;
  PERFORM public.refresh_monthly_due_balance(p_due_member_id);
  RETURN public.get_monthly_due_detail(p_due_member_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_other_income(
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
    WITH friday_rows AS (
      SELECT f.* FROM public.friday_collections f WHERE f.user_id = v_user_id
        AND (p_month IS NULL OR EXTRACT(MONTH FROM f.collection_date)::integer = p_month)
        AND (p_year IS NULL OR EXTRACT(YEAR FROM f.collection_date)::integer = p_year)
    ), rent_rows AS (
      SELECT r.* FROM public.room_rents r WHERE r.user_id = v_user_id
        AND (p_month IS NULL OR EXTRACT(MONTH FROM r.rent_date)::integer = p_month)
        AND (p_year IS NULL OR EXTRACT(YEAR FROM r.rent_date)::integer = p_year)
    )
    SELECT jsonb_build_object(
      'friday_collections', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'collection_date', collection_date, 'amount', amount, 'payment_mode', payment_mode, 'notes', notes, 'created_at', created_at, 'updated_at', updated_at) ORDER BY collection_date) FROM friday_rows), '[]'::jsonb),
      'room_rents', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'rent_date', rent_date, 'amount', amount, 'payment_mode', payment_mode, 'notes', notes, 'created_at', created_at, 'updated_at', updated_at) ORDER BY rent_date, created_at) FROM rent_rows), '[]'::jsonb),
      'friday_total', COALESCE((SELECT SUM(amount) FROM friday_rows), 0),
      'room_rent_total', COALESCE((SELECT SUM(amount) FROM rent_rows), 0),
      'other_total', COALESCE((SELECT SUM(amount) FROM friday_rows), 0) + COALESCE((SELECT SUM(amount) FROM rent_rows), 0),
      'cash_total', COALESCE((SELECT SUM(amount) FROM friday_rows WHERE payment_mode = 'cash'), 0) + COALESCE((SELECT SUM(amount) FROM rent_rows WHERE payment_mode = 'cash'), 0),
      'account_total', COALESCE((SELECT SUM(amount) FROM friday_rows WHERE payment_mode = 'account'), 0) + COALESCE((SELECT SUM(amount) FROM rent_rows WHERE payment_mode = 'account'), 0)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_friday_collection(
  p_collection_date date,
  p_amount numeric,
  p_payment_mode text DEFAULT 'cash',
  p_notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user_id uuid := public.require_active_ledger_session(); v_row public.friday_collections%ROWTYPE;
BEGIN
  IF p_collection_date IS NULL OR EXTRACT(ISODOW FROM p_collection_date) <> 5 THEN RAISE EXCEPTION 'Friday collections must use an actual Friday date.'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Collection amount must be greater than zero.'; END IF;
  IF p_payment_mode NOT IN ('cash', 'account') THEN RAISE EXCEPTION 'Payment mode must be cash or account.'; END IF;
  INSERT INTO public.friday_collections (user_id, collection_date, amount, payment_mode, notes)
  VALUES (v_user_id, p_collection_date, p_amount, p_payment_mode, COALESCE(p_notes, ''))
  ON CONFLICT (user_id, collection_date) DO UPDATE SET amount = EXCLUDED.amount, payment_mode = EXCLUDED.payment_mode, notes = EXCLUDED.notes
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('id', v_row.id, 'collection_date', v_row.collection_date, 'amount', v_row.amount, 'payment_mode', v_row.payment_mode, 'notes', v_row.notes, 'created_at', v_row.created_at, 'updated_at', v_row.updated_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_friday_collection(p_collection_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user_id uuid := public.require_active_ledger_session();
BEGIN
  DELETE FROM public.friday_collections WHERE id = p_collection_id AND user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Friday collection was not found.'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_room_rent(
  p_rent_date date,
  p_amount numeric,
  p_payment_mode text DEFAULT 'cash',
  p_notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user_id uuid := public.require_active_ledger_session(); v_row public.room_rents%ROWTYPE;
BEGIN
  IF p_rent_date IS NULL THEN RAISE EXCEPTION 'Room rent date is required.'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Room rent amount must be greater than zero.'; END IF;
  IF p_payment_mode NOT IN ('cash', 'account') THEN RAISE EXCEPTION 'Payment mode must be cash or account.'; END IF;
  INSERT INTO public.room_rents (user_id, rent_date, amount, payment_mode, notes)
  VALUES (v_user_id, p_rent_date, p_amount, p_payment_mode, COALESCE(p_notes, '')) RETURNING * INTO v_row;
  RETURN jsonb_build_object('id', v_row.id, 'rent_date', v_row.rent_date, 'amount', v_row.amount, 'payment_mode', v_row.payment_mode, 'notes', v_row.notes, 'created_at', v_row.created_at, 'updated_at', v_row.updated_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_room_rent(
  p_rent_id uuid,
  p_rent_date date,
  p_amount numeric,
  p_payment_mode text DEFAULT 'cash',
  p_notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user_id uuid := public.require_active_ledger_session(); v_row public.room_rents%ROWTYPE;
BEGIN
  IF p_rent_date IS NULL THEN RAISE EXCEPTION 'Room rent date is required.'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Room rent amount must be greater than zero.'; END IF;
  IF p_payment_mode NOT IN ('cash', 'account') THEN RAISE EXCEPTION 'Payment mode must be cash or account.'; END IF;
  UPDATE public.room_rents SET rent_date = p_rent_date, amount = p_amount, payment_mode = p_payment_mode, notes = COALESCE(p_notes, '')
  WHERE id = p_rent_id AND user_id = v_user_id RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room rent was not found.'; END IF;
  RETURN jsonb_build_object('id', v_row.id, 'rent_date', v_row.rent_date, 'amount', v_row.amount, 'payment_mode', v_row.payment_mode, 'notes', v_row.notes, 'created_at', v_row.created_at, 'updated_at', v_row.updated_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_room_rent(p_rent_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user_id uuid := public.require_active_ledger_session();
BEGIN
  DELETE FROM public.room_rents WHERE id = p_rent_id AND user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room rent was not found.'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ledger_dashboard_summary(
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
    ), period_payments AS (
      SELECT * FROM public.payments p WHERE p.user_id = v_user_id
        AND (p_month IS NULL OR EXTRACT(MONTH FROM p.payment_date)::integer = p_month)
        AND (p_year IS NULL OR EXTRACT(YEAR FROM p.payment_date)::integer = p_year)
    ), year_payments AS (
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
    )
    SELECT jsonb_build_object(
      'total', (SELECT COUNT(*) FROM selected_dues), 'paid', (SELECT COUNT(*) FROM selected_dues WHERE status = 'paid'),
      'unpaid', (SELECT COUNT(*) FROM selected_dues WHERE status = 'unpaid'), 'pending', (SELECT COUNT(*) FROM selected_dues WHERE status IN ('pending', 'partial')),
      'partial', (SELECT COUNT(*) FROM selected_dues WHERE status = 'partial'), 'expected_dues', COALESCE((SELECT SUM(amount) FROM selected_dues), 0),
      'member_monthly_collection', COALESCE((SELECT SUM(amount) FROM period_payments), 0),
      'member_yearly_collection', COALESCE((SELECT SUM(amount) FROM year_payments), 0),
      'monthly_collection', COALESCE((SELECT SUM(amount) FROM period_payments), 0),
      'yearly_collection', COALESCE((SELECT SUM(amount) FROM year_payments), 0),
      'outstanding', COALESCE((SELECT SUM(amount_pending) FROM selected_dues), 0),
      'member_cash_received', COALESCE((SELECT SUM(amount) FROM period_payments WHERE payment_method = 'cash'), 0),
      'member_account_received', COALESCE((SELECT SUM(amount) FROM period_payments WHERE payment_method = 'account'), 0),
      'friday_collection', COALESCE((SELECT SUM(amount) FROM period_fridays), 0),
      'room_rent_collection', COALESCE((SELECT SUM(amount) FROM period_rents), 0),
      'other_collection', COALESCE((SELECT SUM(amount) FROM period_fridays), 0) + COALESCE((SELECT SUM(amount) FROM period_rents), 0),
      'other_cash_received', COALESCE((SELECT SUM(amount) FROM period_fridays WHERE payment_mode = 'cash'), 0) + COALESCE((SELECT SUM(amount) FROM period_rents WHERE payment_mode = 'cash'), 0),
      'other_account_received', COALESCE((SELECT SUM(amount) FROM period_fridays WHERE payment_mode = 'account'), 0) + COALESCE((SELECT SUM(amount) FROM period_rents WHERE payment_mode = 'account'), 0),
      'total_collection', COALESCE((SELECT SUM(amount) FROM period_payments), 0) + COALESCE((SELECT SUM(amount) FROM period_fridays), 0) + COALESCE((SELECT SUM(amount) FROM period_rents), 0),
      'yearly_friday_collection', COALESCE((SELECT SUM(amount) FROM year_fridays), 0),
      'yearly_room_rent_collection', COALESCE((SELECT SUM(amount) FROM year_rents), 0),
      'yearly_other_collection', COALESCE((SELECT SUM(amount) FROM year_fridays), 0) + COALESCE((SELECT SUM(amount) FROM year_rents), 0),
      'yearly_total_collection', COALESCE((SELECT SUM(amount) FROM year_payments), 0) + COALESCE((SELECT SUM(amount) FROM year_fridays), 0) + COALESCE((SELECT SUM(amount) FROM year_rents), 0),
      'cash_received', COALESCE((SELECT SUM(amount) FROM period_payments WHERE payment_method = 'cash'), 0) + COALESCE((SELECT SUM(amount) FROM period_fridays WHERE payment_mode = 'cash'), 0) + COALESCE((SELECT SUM(amount) FROM period_rents WHERE payment_mode = 'cash'), 0),
      'account_received', COALESCE((SELECT SUM(amount) FROM period_payments WHERE payment_method = 'account'), 0) + COALESCE((SELECT SUM(amount) FROM period_fridays WHERE payment_mode = 'account'), 0) + COALESCE((SELECT SUM(amount) FROM period_rents WHERE payment_mode = 'account'), 0),
      'collection_percent', CASE WHEN COALESCE((SELECT SUM(amount) FROM selected_dues), 0) = 0 THEN 0 ELSE ROUND((COALESCE((SELECT SUM(amount) FROM period_payments), 0) / (SELECT SUM(amount) FROM selected_dues)) * 100, 2) END
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_member_dues(text, text, numeric, integer, integer, boolean, text, numeric, date, text, text, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_monthly_due(uuid, text, text, numeric, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_other_income(integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_friday_collection(date, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_friday_collection(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_room_rent(date, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_room_rent(uuid, date, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_room_rent(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_ledger_dashboard_summary(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_member_dues(text, text, numeric, integer, integer, boolean, text, numeric, date, text, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_monthly_due(uuid, text, text, numeric, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_other_income(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_friday_collection(date, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_friday_collection(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_room_rent(date, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_room_rent(uuid, date, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_room_rent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ledger_dashboard_summary(integer, integer) TO authenticated;

COMMIT;
