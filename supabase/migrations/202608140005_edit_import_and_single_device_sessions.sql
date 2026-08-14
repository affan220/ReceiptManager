BEGIN;

CREATE TABLE IF NOT EXISTS public.active_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_hash text NOT NULL UNIQUE,
  device_label text NOT NULL DEFAULT 'Browser',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS active_sessions_one_live_session_per_user_idx
  ON public.active_sessions (user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS active_sessions_user_seen_idx
  ON public.active_sessions (user_id, last_seen_at DESC);

ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.active_sessions FROM anon, authenticated;
GRANT ALL ON public.active_sessions TO service_role;

CREATE OR REPLACE FUNCTION public.current_session_hash()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT encode(extensions.digest(COALESCE(auth.jwt() ->> 'session_id', ''), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.is_current_device_session()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.active_sessions
      WHERE user_id = auth.uid()
        AND session_hash = public.current_session_hash()
        AND revoked_at IS NULL
        AND expires_at > now()
    );
$$;

CREATE OR REPLACE FUNCTION public.claim_active_session(
  p_take_over boolean DEFAULT false,
  p_device_label text DEFAULT 'Browser'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  existing public.active_sessions%ROWTYPE;
  v_user_id uuid := auth.uid();
  v_hash text := public.current_session_hash();
  v_label text := left(NULLIF(btrim(COALESCE(p_device_label, '')), ''), 120);
BEGIN
  IF v_user_id IS NULL OR COALESCE(auth.jwt() ->> 'session_id', '') = '' THEN
    RAISE EXCEPTION 'An authenticated session is required.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  UPDATE public.active_sessions
  SET revoked_at = now()
  WHERE user_id = v_user_id
    AND revoked_at IS NULL
    AND expires_at <= now();

  SELECT * INTO existing
  FROM public.active_sessions
  WHERE user_id = v_user_id
    AND revoked_at IS NULL
    AND session_hash <> v_hash
  ORDER BY last_seen_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND NOT p_take_over THEN
    RETURN jsonb_build_object(
      'status', 'active_elsewhere',
      'device_label', existing.device_label,
      'last_seen_at', existing.last_seen_at
    );
  END IF;

  IF FOUND AND p_take_over THEN
    UPDATE public.active_sessions
    SET revoked_at = now()
    WHERE id = existing.id;
  END IF;

  UPDATE public.active_sessions
  SET last_seen_at = now(),
      expires_at = now() + interval '24 hours',
      device_label = COALESCE(v_label, device_label),
      revoked_at = NULL
  WHERE user_id = v_user_id
    AND session_hash = v_hash;

  IF NOT FOUND THEN
    INSERT INTO public.active_sessions (user_id, session_hash, device_label)
    VALUES (v_user_id, v_hash, COALESCE(v_label, 'Browser'));
  END IF;

  UPDATE public.profiles
  SET last_login_at = now()
  WHERE id = v_user_id;

  RETURN jsonb_build_object('status', CASE WHEN p_take_over THEN 'taken_over' ELSE 'claimed' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_active_session()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.active_sessions
  SET last_seen_at = now(), expires_at = now() + interval '24 hours'
  WHERE user_id = auth.uid()
    AND session_hash = public.current_session_hash()
    AND revoked_at IS NULL
    AND expires_at > now();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_active_session()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.active_sessions
  SET revoked_at = now()
  WHERE user_id = auth.uid()
    AND session_hash = public.current_session_hash()
    AND revoked_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_active_session(boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_active_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_active_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_current_device_session() TO authenticated;

CREATE OR REPLACE FUNCTION public.bulk_import_members(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item jsonb;
  row_no integer := 0;
  row_errors text[];
  v_name text;
  v_phone text;
  v_status text;
  v_mode text;
  v_amount numeric;
  v_month integer;
  v_year integer;
  v_months_pending integer;
  v_date_text text;
  v_date date;
  v_voucher text;
  v_key text;
  valid_rows jsonb := '[]'::jsonb;
  errors jsonb := '[]'::jsonb;
  seen_vouchers text[] := ARRAY[]::text[];
  seen_member_keys text[] := ARRAY[]::text[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_current_device_session() THEN
    RAISE EXCEPTION 'Your session has ended because this account was signed in on another device.';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Import data must be an array of rows.';
  END IF;
  IF jsonb_array_length(p_rows) > 1000 THEN
    RAISE EXCEPTION 'A maximum of 1,000 rows can be imported at once.';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    row_no := row_no + 1;
    row_errors := ARRAY[]::text[];
    v_name := btrim(COALESCE(item ->> 'name', ''));
    v_phone := btrim(COALESCE(item ->> 'phone', ''));
    v_status := lower(btrim(COALESCE(item ->> 'status', 'unpaid')));
    v_mode := lower(btrim(COALESCE(item ->> 'payment_mode', 'cash')));
    v_date_text := btrim(COALESCE(item ->> 'payment_date', ''));
    v_voucher := btrim(COALESCE(item ->> 'voucher_number', ''));

    IF v_name = '' THEN row_errors := array_append(row_errors, 'Member name is required.'); END IF;
    IF v_phone = '' THEN row_errors := array_append(row_errors, 'Phone is required.'); END IF;
    IF v_status NOT IN ('paid', 'unpaid', 'pending') THEN row_errors := array_append(row_errors, 'Payment status must be paid, unpaid, or pending.'); END IF;
    IF v_mode NOT IN ('cash', 'account') THEN row_errors := array_append(row_errors, 'Payment method must be cash or account.'); END IF;
    IF COALESCE(item ->> 'amount', '') !~ '^\s*\d+(\.\d{1,2})?\s*$' THEN
      row_errors := array_append(row_errors, 'Invalid amount.');
      v_amount := 0;
    ELSE
      v_amount := (item ->> 'amount')::numeric;
    END IF;
    IF COALESCE(item ->> 'month', '') !~ '^\d{1,2}$' OR (item ->> 'month')::integer NOT BETWEEN 1 AND 12 THEN
      row_errors := array_append(row_errors, 'Month must be between 1 and 12.');
      v_month := EXTRACT(MONTH FROM CURRENT_DATE)::integer;
    ELSE
      v_month := (item ->> 'month')::integer;
    END IF;
    IF COALESCE(item ->> 'year', '') !~ '^\d{4}$' OR (item ->> 'year')::integer NOT BETWEEN 2000 AND 2100 THEN
      row_errors := array_append(row_errors, 'Year must be between 2000 and 2100.');
      v_year := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
    ELSE
      v_year := (item ->> 'year')::integer;
    END IF;
    IF COALESCE(item ->> 'months_pending', '0') !~ '^\d+$' THEN
      row_errors := array_append(row_errors, 'Months pending must be a whole number.');
      v_months_pending := 0;
    ELSE
      v_months_pending := COALESCE(NULLIF(item ->> 'months_pending', ''), '0')::integer;
    END IF;

    v_date := NULL;
    IF v_status = 'paid' THEN
      IF v_date_text = '' THEN
        row_errors := array_append(row_errors, 'Payment date is required for paid rows.');
      ELSIF v_date_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND to_char(to_date(v_date_text, 'YYYY-MM-DD'), 'YYYY-MM-DD') = v_date_text THEN
        v_date := v_date_text::date;
      ELSIF v_date_text ~ '^[0-9]{2}-[0-9]{2}-[0-9]{4}$' AND to_char(to_date(v_date_text, 'DD-MM-YYYY'), 'DD-MM-YYYY') = v_date_text THEN
        v_date := to_date(v_date_text, 'DD-MM-YYYY');
      ELSIF v_date_text ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' AND to_char(to_date(v_date_text, 'DD/MM/YYYY'), 'DD/MM/YYYY') = v_date_text THEN
        v_date := to_date(v_date_text, 'DD/MM/YYYY');
      ELSE
        row_errors := array_append(row_errors, 'Invalid payment date. Use YYYY-MM-DD or DD-MM-YYYY.');
      END IF;
    END IF;

    IF v_voucher <> '' THEN
      IF v_voucher !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$' THEN
        row_errors := array_append(row_errors, 'Voucher number contains invalid characters.');
      ELSIF lower(v_voucher) = ANY(seen_vouchers) THEN
        row_errors := array_append(row_errors, 'Voucher number is duplicated in this file.');
      ELSIF EXISTS (
        SELECT 1 FROM public.members
        WHERE user_id = auth.uid() AND lower(COALESCE(voucher_number, '')) = lower(v_voucher)
        LIMIT 1
      ) OR EXISTS (
        SELECT 1 FROM public.payments
        WHERE user_id = auth.uid() AND lower(voucher_number) = lower(v_voucher)
        LIMIT 1
      ) THEN
        row_errors := array_append(row_errors, 'Voucher number already exists.');
      ELSE
        seen_vouchers := array_append(seen_vouchers, lower(v_voucher));
      END IF;
    END IF;

    v_key := lower(v_name) || '|' || lower(v_phone) || '|' || v_month || '|' || v_year;
    IF v_key = '|||' THEN
      NULL;
    ELSIF v_key = ANY(seen_member_keys) THEN
      row_errors := array_append(row_errors, 'Duplicate member row in this file.');
    ELSIF EXISTS (
      SELECT 1 FROM public.members
      WHERE user_id = auth.uid()
        AND lower(name) = lower(v_name)
        AND lower(COALESCE(phone, '')) = lower(v_phone)
        AND month = v_month
        AND year = v_year
      LIMIT 1
    ) THEN
      row_errors := array_append(row_errors, 'A member with the same name, phone, and contribution period already exists.');
    ELSE
      seen_member_keys := array_append(seen_member_keys, v_key);
    END IF;

    IF COALESCE(array_length(row_errors, 1), 0) = 0 THEN
      valid_rows := valid_rows || jsonb_build_array(jsonb_build_object(
        'name', v_name,
        'phone', v_phone,
        'amount', v_amount,
        'status', v_status,
        'payment_mode', v_mode,
        'month', v_month,
        'year', v_year,
        'months_pending', v_months_pending,
        'payment_date', v_date,
        'voucher_number', NULLIF(v_voucher, '')
      ));
    ELSE
      errors := errors || jsonb_build_array(jsonb_build_object('row', row_no + 1, 'errors', to_jsonb(row_errors)));
    END IF;
  END LOOP;

  IF jsonb_array_length(valid_rows) > 0 THEN
    INSERT INTO public.members (
      user_id, name, phone, amount, status, payment_mode, month, year,
      months_pending, payment_date, voucher_number, hold
    )
    SELECT auth.uid(), name, phone, amount, status, payment_mode, month, year,
      months_pending, payment_date, voucher_number, false
    FROM jsonb_to_recordset(valid_rows) AS row_data(
      name text, phone text, amount numeric, status text, payment_mode text,
      month integer, year integer, months_pending integer, payment_date date,
      voucher_number text
    );
  END IF;

  RETURN jsonb_build_object(
    'imported_count', jsonb_array_length(valid_rows),
    'failed_count', jsonb_array_length(errors),
    'errors', errors
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_import_members(jsonb) TO authenticated;

COMMIT;
