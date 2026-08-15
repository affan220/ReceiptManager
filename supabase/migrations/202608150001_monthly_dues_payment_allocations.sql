BEGIN;

-- The existing `members` rows remain the application's monthly due records so all
-- existing member IDs, receipt links, and historical payment references remain valid.
-- `member_identities` adds the stable person-level identity needed to group months.
CREATE TABLE IF NOT EXISTS public.member_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS member_identities_user_name_phone_unique_idx
  ON public.member_identities (user_id, lower(name), lower(phone));
CREATE INDEX IF NOT EXISTS member_identities_user_id_idx
  ON public.member_identities (user_id);

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS member_identity_id uuid REFERENCES public.member_identities(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  ADD COLUMN IF NOT EXISTS amount_pending numeric NOT NULL DEFAULT 0 CHECK (amount_pending >= 0),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS ledger_migrated_at timestamptz,
  ADD COLUMN IF NOT EXISTS legacy_review_required boolean NOT NULL DEFAULT false;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS member_identity_id uuid REFERENCES public.member_identities(id) ON DELETE RESTRICT;

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voucher_number text,
  ADD COLUMN IF NOT EXISTS payment_date date,
  ADD COLUMN IF NOT EXISTS payment_method text CHECK (payment_method IN ('cash', 'account'));

-- Legacy member-row payment triggers would mutate payment history when a due is edited.
-- Ledger procedures below are now the only write path for payments and allocations.
DROP TRIGGER IF EXISTS trg_members_prepare_payment ON public.members;
DROP TRIGGER IF EXISTS trg_members_sync_payment ON public.members;
DROP INDEX IF EXISTS public.members_user_voucher_number_unique_idx;

-- Permit the explicit Partially Paid state while retaining existing status values.
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.members'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.members DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;
END;
$$;
ALTER TABLE public.members
  ADD CONSTRAINT members_status_check CHECK (status IN ('paid', 'unpaid', 'pending', 'partial'));

-- Build a master identity for every existing row without altering or deleting that row.
INSERT INTO public.member_identities (user_id, name, phone)
SELECT DISTINCT user_id, btrim(name), btrim(COALESCE(phone, ''))
FROM public.members
WHERE member_identity_id IS NULL
ON CONFLICT (user_id, lower(name), lower(phone)) DO NOTHING;

UPDATE public.members m
SET member_identity_id = i.id
FROM public.member_identities i
WHERE m.member_identity_id IS NULL
  AND i.user_id = m.user_id
  AND lower(i.name) = lower(btrim(m.name))
  AND lower(i.phone) = lower(btrim(COALESCE(m.phone, '')));

ALTER TABLE public.members
  ALTER COLUMN member_identity_id SET NOT NULL;

UPDATE public.payments p
SET member_identity_id = m.member_identity_id
FROM public.members m
WHERE p.member_id = m.id
  AND p.member_identity_id IS NULL;

ALTER TABLE public.payments
  ALTER COLUMN member_identity_id SET NOT NULL;

-- Backfill due balances from existing records. A paid historical member has a payment
-- record; its allocation is created below. Unresolved manually-entered pending counts
-- are flagged for review rather than guessed into fabricated months.
UPDATE public.members
SET amount_paid = CASE WHEN status = 'paid' THEN amount ELSE 0 END,
    amount_pending = CASE WHEN status = 'paid' THEN 0 ELSE amount END,
    ledger_migrated_at = now(),
    legacy_review_required = COALESCE(months_pending, 0) > 0
WHERE ledger_migrated_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS members_user_identity_period_unique_idx
  ON public.members (user_id, member_identity_id, month, year);
CREATE INDEX IF NOT EXISTS members_user_period_active_idx
  ON public.members (user_id, year, month)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS members_identity_period_active_idx
  ON public.members (member_identity_id, year, month)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS payments_identity_payment_date_idx
  ON public.payments (member_identity_id, payment_date DESC, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS receipts_user_payment_unique_idx
  ON public.receipts (user_id, payment_id)
  WHERE payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  monthly_due_id uuid NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  allocated_amount numeric NOT NULL CHECK (allocated_amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, monthly_due_id)
);

CREATE INDEX IF NOT EXISTS payment_allocations_payment_idx
  ON public.payment_allocations (payment_id);
CREATE INDEX IF NOT EXISTS payment_allocations_due_idx
  ON public.payment_allocations (monthly_due_id);
CREATE INDEX IF NOT EXISTS payment_allocations_user_due_idx
  ON public.payment_allocations (user_id, monthly_due_id);

-- Reconcile the actual paid and pending values of a single monthly due.
CREATE OR REPLACE FUNCTION public.refresh_monthly_due_balance(p_due_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_due public.members%ROWTYPE;
  v_paid numeric;
BEGIN
  SELECT * INTO v_due
  FROM public.members
  WHERE id = p_due_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0)
  INTO v_paid
  FROM public.payment_allocations
  WHERE monthly_due_id = p_due_id;

  IF v_paid > v_due.amount THEN
    RAISE EXCEPTION 'Allocated payment amount cannot exceed the monthly due.';
  END IF;

  UPDATE public.members
  SET amount_paid = v_paid,
      amount_pending = GREATEST(v_due.amount - v_paid, 0),
      status = CASE
        WHEN v_paid >= v_due.amount THEN 'paid'
        WHEN v_paid > 0 THEN 'partial'
        WHEN v_due.status = 'unpaid' THEN 'unpaid'
        ELSE 'pending'
      END,
      months_pending = (
        SELECT COUNT(*)::integer
        FROM public.members sibling
        WHERE sibling.member_identity_id = v_due.member_identity_id
          AND sibling.deleted_at IS NULL
          AND sibling.amount_pending > 0
      )
  WHERE id = p_due_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_monthly_due_from_allocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_monthly_due_balance(COALESCE(NEW.monthly_due_id, OLD.monthly_due_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_allocations_reconcile_due ON public.payment_allocations;
CREATE TRIGGER trg_payment_allocations_reconcile_due
AFTER INSERT OR UPDATE OR DELETE ON public.payment_allocations
FOR EACH ROW EXECUTE FUNCTION public.reconcile_monthly_due_from_allocation();

-- Existing payments are preserved as the only actual-money rows. Where their linked
-- monthly due is known, create exactly one matching allocation; no duplicate payment
-- transactions are introduced by this migration.
INSERT INTO public.payment_allocations (user_id, payment_id, monthly_due_id, allocated_amount)
SELECT p.user_id, p.id, p.member_id, LEAST(p.amount, m.amount)
FROM public.payments p
JOIN public.members m ON m.id = p.member_id
LEFT JOIN public.payment_allocations existing ON existing.payment_id = p.id
WHERE existing.id IS NULL
  AND p.payment_status = 'paid'
  AND p.amount > 0
  AND m.amount > 0;

UPDATE public.members m
SET legacy_review_required = true
WHERE m.status = 'paid'
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_allocations a WHERE a.monthly_due_id = m.id
  );

CREATE OR REPLACE FUNCTION public.require_active_ledger_session()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR NOT public.is_current_device_session() THEN
    RAISE EXCEPTION 'Your session has ended because this account was signed in on another device.';
  END IF;
  RETURN v_user_id;
END;
$$;

-- Safe all-month/single-month creator. A master identity is reused only for the same
-- account, name, and phone. One database transaction creates all missing month records.
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

  RETURN jsonb_build_object(
    'member_identity_id', v_identity_id,
    'created_count', v_created_count,
    'skipped_count', v_skipped_count,
    'created_due_ids', v_created_ids,
    'payment', v_payment
  );
END;
$$;

-- Creates one immutable real payment and allocates it to oldest unpaid dues by default.
-- A supplied allocation list is honored exactly after database validation.
CREATE OR REPLACE FUNCTION public.record_member_payment(
  p_due_member_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_payment_method text,
  p_voucher_number text DEFAULT NULL,
  p_notes text DEFAULT '',
  p_allocations jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := public.require_active_ledger_session();
  v_due public.members%ROWTYPE;
  v_target public.members%ROWTYPE;
  v_payment_id uuid;
  v_voucher text;
  v_remaining numeric;
  v_allocated numeric := 0;
  v_allocation jsonb;
  v_seen_due_ids uuid[] := ARRAY[]::uuid[];
  rec record;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Payment amount must be greater than zero.'; END IF;
  IF p_payment_date IS NULL THEN RAISE EXCEPTION 'Payment date is required.'; END IF;
  IF p_payment_method NOT IN ('cash', 'account') THEN RAISE EXCEPTION 'Payment mode must be cash or account.'; END IF;

  SELECT * INTO v_due
  FROM public.members
  WHERE id = p_due_member_id
    AND user_id = v_user_id
    AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Monthly contribution record was not found.'; END IF;

  IF p_allocations IS NOT NULL AND jsonb_typeof(p_allocations) = 'array' AND jsonb_array_length(p_allocations) > 0 THEN
    FOR rec IN
      SELECT (item ->> 'monthly_due_id')::uuid AS monthly_due_id,
             (item ->> 'allocated_amount')::numeric AS allocated_amount
      FROM jsonb_array_elements(p_allocations) item
    LOOP
      IF rec.allocated_amount IS NULL OR rec.allocated_amount <= 0 THEN
        RAISE EXCEPTION 'Every manual allocation amount must be greater than zero.';
      END IF;
      IF rec.monthly_due_id = ANY(v_seen_due_ids) THEN
        RAISE EXCEPTION 'A monthly due can only be selected once in one payment.';
      END IF;
      v_seen_due_ids := array_append(v_seen_due_ids, rec.monthly_due_id);

      SELECT * INTO v_target
      FROM public.members
      WHERE id = rec.monthly_due_id
        AND user_id = v_user_id
        AND member_identity_id = v_due.member_identity_id
        AND deleted_at IS NULL
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'An allocation references an unavailable monthly due.'; END IF;
      IF rec.allocated_amount > v_target.amount_pending THEN
        RAISE EXCEPTION 'Allocation for %/% exceeds that month''s remaining due.', v_target.month, v_target.year;
      END IF;
      v_allocated := v_allocated + rec.allocated_amount;
    END LOOP;
    IF v_allocated <> p_amount THEN
      RAISE EXCEPTION 'Manual allocations must equal the payment amount.';
    END IF;
    v_allocation := p_allocations;
  ELSE
    v_remaining := p_amount;
    v_allocation := '[]'::jsonb;
    FOR rec IN
      SELECT id, amount_pending
      FROM public.members
      WHERE user_id = v_user_id
        AND member_identity_id = v_due.member_identity_id
        AND deleted_at IS NULL
        AND amount_pending > 0
        AND hold = false
      ORDER BY year ASC, month ASC, created_at ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_allocated := LEAST(v_remaining, rec.amount_pending);
      v_allocation := v_allocation || jsonb_build_array(jsonb_build_object(
        'monthly_due_id', rec.id,
        'allocated_amount', v_allocated
      ));
      v_remaining := v_remaining - v_allocated;
    END LOOP;
    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Payment amount exceeds the available outstanding balance. Adjust the allocation or payment amount.';
    END IF;
  END IF;

  v_voucher := NULLIF(btrim(COALESCE(p_voucher_number, '')), '');
  IF v_voucher IS NULL THEN
    v_voucher := public.next_voucher_number(v_user_id);
  END IF;

  INSERT INTO public.payments (
    user_id, member_id, member_identity_id, voucher_number, payment_date,
    amount, payment_status, payment_method, notes
  ) VALUES (
    v_user_id, p_due_member_id, v_due.member_identity_id, v_voucher, p_payment_date,
    p_amount, 'paid', p_payment_method, COALESCE(p_notes, '')
  ) RETURNING id INTO v_payment_id;

  INSERT INTO public.payment_allocations (user_id, payment_id, monthly_due_id, allocated_amount)
  SELECT v_user_id,
         v_payment_id,
         (item ->> 'monthly_due_id')::uuid,
         (item ->> 'allocated_amount')::numeric
  FROM jsonb_array_elements(v_allocation) item;

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'voucher_number', v_voucher,
    'payment_date', p_payment_date,
    'amount', p_amount,
    'payment_method', p_payment_method,
    'allocations', v_allocation
  );
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
BEGIN
  IF btrim(COALESCE(p_name, '')) = '' THEN RAISE EXCEPTION 'Member name is required.'; END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN RAISE EXCEPTION 'Monthly amount must be zero or greater.'; END IF;
  IF p_status IS NOT NULL AND lower(btrim(p_status)) NOT IN ('unpaid', 'pending', 'paid', 'partial') THEN
    RAISE EXCEPTION 'Invalid contribution status.';
  END IF;

  SELECT * INTO v_due
  FROM public.members
  WHERE id = p_due_member_id
    AND user_id = v_user_id
    AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Monthly contribution record was not found.'; END IF;
  IF p_amount < v_due.amount_paid THEN
    RAISE EXCEPTION 'Monthly amount cannot be reduced below the amount already allocated to this due.';
  END IF;

  IF v_due.amount_paid > 0 AND p_status IS NOT NULL AND lower(btrim(p_status)) NOT IN ('paid', 'partial') THEN
    RAISE EXCEPTION 'A due with recorded payments cannot be changed back to unpaid or pending. Record a correcting payment instead.';
  END IF;

  UPDATE public.members
  SET name = btrim(p_name),
      phone = btrim(COALESCE(p_phone, '')),
      amount = p_amount,
      hold = COALESCE(p_hold, false),
      status = CASE
        WHEN amount_paid > 0 THEN status
        WHEN p_status IS NOT NULL THEN lower(btrim(p_status))
        ELSE status
      END
  WHERE id = p_due_member_id;

  PERFORM public.refresh_monthly_due_balance(p_due_member_id);
  RETURN public.get_monthly_due_detail(p_due_member_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_monthly_due(p_due_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user_id uuid := public.require_active_ledger_session();
BEGIN
  UPDATE public.members
  SET deleted_at = now()
  WHERE id = p_due_member_id
    AND user_id = v_user_id
    AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Monthly contribution record was not found.'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_monthly_due_detail(p_due_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user_id uuid := public.require_active_ledger_session();
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'due', to_jsonb(due_row),
      'dues', COALESCE((
        SELECT jsonb_agg(to_jsonb(related_due) ORDER BY related_due.year, related_due.month)
        FROM (
          SELECT m.id, m.name, m.phone, m.amount, m.amount_paid, m.amount_pending, m.status,
                 m.month, m.year, m.hold, m.member_identity_id, m.created_at, m.updated_at
          FROM public.members m
          WHERE m.user_id = v_user_id
            AND m.member_identity_id = due_row.member_identity_id
            AND m.deleted_at IS NULL
        ) related_due
      ), '[]'::jsonb),
      'payments', COALESCE((
        SELECT jsonb_agg(payment_row ORDER BY (payment_row ->> 'payment_date') DESC, (payment_row ->> 'created_at') DESC)
        FROM (
          SELECT jsonb_build_object(
            'id', p.id,
            'member_id', p.member_id,
            'member_identity_id', p.member_identity_id,
            'voucher_number', p.voucher_number,
            'payment_date', p.payment_date,
            'amount', p.amount,
            'payment_status', p.payment_status,
            'payment_method', p.payment_method,
            'notes', p.notes,
            'created_at', p.created_at,
            'updated_at', p.updated_at,
            'allocations', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', a.id,
                'monthly_due_id', a.monthly_due_id,
                'allocated_amount', a.allocated_amount,
                'month', allocated_due.month,
                'year', allocated_due.year,
                'due_amount', allocated_due.amount,
                'member_name', allocated_due.name
              ) ORDER BY allocated_due.year, allocated_due.month)
              FROM public.payment_allocations a
              JOIN public.members allocated_due ON allocated_due.id = a.monthly_due_id
              WHERE a.payment_id = p.id
            ), '[]'::jsonb)
          ) payment_row
          FROM public.payments p
          WHERE p.user_id = v_user_id
            AND p.member_identity_id = due_row.member_identity_id
        ) payment_rows
      ), '[]'::jsonb)
    )
    FROM (
      SELECT m.id, m.name, m.phone, m.amount, m.amount_paid, m.amount_pending, m.status,
             m.month, m.year, m.hold, m.member_identity_id, m.created_at, m.updated_at,
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
             COALESCE((
               SELECT latest_payment.payment_method
               FROM public.payment_allocations a
               JOIN public.payments latest_payment ON latest_payment.id = a.payment_id
               WHERE a.monthly_due_id = m.id
               ORDER BY latest_payment.payment_date DESC, latest_payment.created_at DESC
               LIMIT 1
             ), m.payment_mode) AS payment_mode,
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
      WHERE m.id = p_due_member_id
        AND m.user_id = v_user_id
        AND m.deleted_at IS NULL
      LIMIT 1
    ) due_row
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ledger_members()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user_id uuid := public.require_active_ledger_session();
BEGIN
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
    ) member_row
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ledger_payments()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user_id uuid := public.require_active_ledger_session();
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(payment_row ORDER BY (payment_row ->> 'payment_date') DESC, (payment_row ->> 'created_at') DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', p.id,
        'member_id', p.member_id,
        'member_identity_id', p.member_identity_id,
        'voucher_number', p.voucher_number,
        'payment_date', p.payment_date,
        'amount', p.amount,
        'payment_status', p.payment_status,
        'payment_method', p.payment_method,
        'notes', p.notes,
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'allocations', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', a.id,
            'monthly_due_id', a.monthly_due_id,
            'allocated_amount', a.allocated_amount,
            'month', m.month,
            'year', m.year,
            'due_amount', m.amount,
            'member_name', m.name
          ) ORDER BY m.year, m.month)
          FROM public.payment_allocations a
          JOIN public.members m ON m.id = a.monthly_due_id
          WHERE a.payment_id = p.id
        ), '[]'::jsonb)
      ) payment_row
      FROM public.payments p
      WHERE p.user_id = v_user_id
    ) payment_rows
  ), '[]'::jsonb);
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
      SELECT * FROM public.members m
      WHERE m.user_id = v_user_id
        AND m.deleted_at IS NULL
        AND (p_month IS NULL OR m.month = p_month)
        AND (p_year IS NULL OR m.year = p_year)
    ), period_payments AS (
      SELECT * FROM public.payments p
      WHERE p.user_id = v_user_id
        AND (p_month IS NULL OR EXTRACT(MONTH FROM p.payment_date)::integer = p_month)
        AND (p_year IS NULL OR EXTRACT(YEAR FROM p.payment_date)::integer = p_year)
    ), year_payments AS (
      SELECT * FROM public.payments p
      WHERE p.user_id = v_user_id
        AND (p_year IS NULL OR EXTRACT(YEAR FROM p.payment_date)::integer = p_year)
    )
    SELECT jsonb_build_object(
      'total', (SELECT COUNT(*) FROM selected_dues),
      'paid', (SELECT COUNT(*) FROM selected_dues WHERE status = 'paid'),
      'unpaid', (SELECT COUNT(*) FROM selected_dues WHERE status = 'unpaid'),
      'pending', (SELECT COUNT(*) FROM selected_dues WHERE status IN ('pending', 'partial')),
      'partial', (SELECT COUNT(*) FROM selected_dues WHERE status = 'partial'),
      'expected_dues', COALESCE((SELECT SUM(amount) FROM selected_dues), 0),
      'monthly_collection', COALESCE((SELECT SUM(amount) FROM period_payments), 0),
      'yearly_collection', COALESCE((SELECT SUM(amount) FROM year_payments), 0),
      'outstanding', COALESCE((SELECT SUM(amount_pending) FROM selected_dues), 0),
      'cash_received', COALESCE((SELECT SUM(amount) FROM period_payments WHERE payment_method = 'cash'), 0),
      'account_received', COALESCE((SELECT SUM(amount) FROM period_payments WHERE payment_method = 'account'), 0),
      'collection_percent', CASE
        WHEN COALESCE((SELECT SUM(amount) FROM selected_dues), 0) = 0 THEN 0
        ELSE ROUND((COALESCE((SELECT SUM(amount) FROM period_payments), 0) / (SELECT SUM(amount) FROM selected_dues)) * 100, 2)
      END
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_payment_receipt(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := public.require_active_ledger_session();
  v_payment public.payments%ROWTYPE;
  v_due public.members%ROWTYPE;
  v_receipt_seq integer;
  v_receipt_no text;
BEGIN
  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id AND user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment was not found.'; END IF;

  SELECT r.receipt_no INTO v_receipt_no
  FROM public.receipts r
  WHERE r.user_id = v_user_id AND r.payment_id = p_payment_id
  LIMIT 1;
  IF v_receipt_no IS NOT NULL THEN
    RETURN jsonb_build_object(
      'receipt_no', v_receipt_no,
      'payment_id', v_payment.id,
      'voucher_number', v_payment.voucher_number,
      'payment_date', v_payment.payment_date,
      'amount', v_payment.amount,
      'payment_method', v_payment.payment_method
    );
  END IF;

  SELECT m.* INTO v_due
  FROM public.payment_allocations a
  JOIN public.members m ON m.id = a.monthly_due_id
  WHERE a.payment_id = p_payment_id
  ORDER BY m.year, m.month
  LIMIT 1;
  IF NOT FOUND THEN
    SELECT * INTO v_due FROM public.members WHERE id = v_payment.member_id;
  END IF;

  SELECT public.next_receipt_number() INTO v_receipt_seq;
  SELECT COALESCE(receipt_prefix, 'RCPT') || '-' || EXTRACT(YEAR FROM v_payment.payment_date)::text || '-' || lpad(v_receipt_seq::text, 5, '0')
  INTO v_receipt_no
  FROM public.org_settings
  WHERE user_id = v_user_id;

  INSERT INTO public.receipts (
    user_id, member_id, month, year, amount, status, receipt_no,
    payment_id, voucher_number, payment_date, payment_method
  ) VALUES (
    v_user_id, v_due.id, v_due.month, v_due.year, v_payment.amount, 'paid', v_receipt_no,
    v_payment.id, v_payment.voucher_number, v_payment.payment_date, v_payment.payment_method
  );

  RETURN jsonb_build_object(
    'receipt_no', v_receipt_no,
    'payment_id', v_payment.id,
    'voucher_number', v_payment.voucher_number,
    'payment_date', v_payment.payment_date,
    'amount', v_payment.amount,
    'payment_method', v_payment.payment_method
  );
END;
$$;

-- Replace the legacy flat importer with an all-month aware, validation-first batch RPC.
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
  v_month_text text;
  v_month integer;
  v_year integer;
  v_date_text text;
  v_date date;
  v_voucher text;
  v_all_months boolean;
  v_payment_amount numeric;
  v_payment_amount_text text;
  v_result jsonb;
  errors jsonb := '[]'::jsonb;
  imported_count integer := 0;
  created_count integer;
  skipped_count integer;
BEGIN
  PERFORM public.require_active_ledger_session();
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'Import data must be an array of rows.'; END IF;
  IF jsonb_array_length(p_rows) > 1000 THEN RAISE EXCEPTION 'A maximum of 1,000 rows can be imported at once.'; END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    row_no := row_no + 1;
    row_errors := ARRAY[]::text[];
    v_name := btrim(COALESCE(item ->> 'name', ''));
    v_phone := btrim(COALESCE(item ->> 'phone', ''));
    v_status := lower(btrim(COALESCE(item ->> 'status', 'unpaid')));
    v_mode := lower(btrim(COALESCE(item ->> 'payment_mode', 'cash')));
    v_month_text := upper(btrim(COALESCE(item ->> 'month', '')));
    v_date_text := btrim(COALESCE(item ->> 'payment_date', ''));
    v_voucher := btrim(COALESCE(item ->> 'voucher_number', ''));
    v_payment_amount_text := btrim(COALESCE(item ->> 'payment_amount', ''));

    IF v_name = '' THEN row_errors := array_append(row_errors, 'Member name is required.'); END IF;
    IF v_phone = '' THEN row_errors := array_append(row_errors, 'Phone is required.'); END IF;
    IF v_status NOT IN ('paid', 'unpaid', 'pending', 'partial') THEN row_errors := array_append(row_errors, 'Payment status must be paid, unpaid, pending, or partial.'); END IF;
    IF v_mode NOT IN ('cash', 'account') THEN row_errors := array_append(row_errors, 'Payment mode must be cash or account.'); END IF;
    IF COALESCE(item ->> 'amount', '') !~ '^\s*\d+(\.\d{1,2})?\s*$' THEN
      row_errors := array_append(row_errors, 'Invalid monthly amount.'); v_amount := 0;
    ELSE v_amount := (item ->> 'amount')::numeric; END IF;
    IF COALESCE(item ->> 'year', '') !~ '^\d{4}$' OR (item ->> 'year')::integer NOT BETWEEN 2000 AND 2100 THEN
      row_errors := array_append(row_errors, 'Year must be between 2000 and 2100.'); v_year := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
    ELSE v_year := (item ->> 'year')::integer; END IF;

    v_all_months := v_month_text IN ('ALL MONTHS', 'ALL_MONTHS', 'ALL');
    IF v_all_months THEN
      v_month := 1;
    ELSIF v_month_text !~ '^\d{1,2}$' OR v_month_text::integer NOT BETWEEN 1 AND 12 THEN
      row_errors := array_append(row_errors, 'Month must be 1-12 or ALL MONTHS.'); v_month := 1;
    ELSE v_month := v_month_text::integer; END IF;

    v_date := NULL;
    IF v_status IN ('paid', 'partial') THEN
      IF v_date_text = '' THEN row_errors := array_append(row_errors, 'Payment date is required for paid or partial rows.');
      ELSIF v_date_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND to_char(to_date(v_date_text, 'YYYY-MM-DD'), 'YYYY-MM-DD') = v_date_text THEN v_date := v_date_text::date;
      ELSIF v_date_text ~ '^[0-9]{2}-[0-9]{2}-[0-9]{4}$' AND to_char(to_date(v_date_text, 'DD-MM-YYYY'), 'DD-MM-YYYY') = v_date_text THEN v_date := to_date(v_date_text, 'DD-MM-YYYY');
      ELSIF v_date_text ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' AND to_char(to_date(v_date_text, 'DD/MM/YYYY'), 'DD/MM/YYYY') = v_date_text THEN v_date := to_date(v_date_text, 'DD/MM/YYYY');
      ELSE row_errors := array_append(row_errors, 'Invalid payment date. Use YYYY-MM-DD, DD-MM-YYYY, or DD/MM/YYYY.'); END IF;
    END IF;

    IF v_status IN ('paid', 'partial') THEN
      IF v_payment_amount_text = '' THEN
        v_payment_amount := v_amount;
      ELSIF v_payment_amount_text !~ '^\s*\d+(\.\d{1,2})?\s*$' OR v_payment_amount_text::numeric <= 0 THEN
        row_errors := array_append(row_errors, 'Actual payment amount must be greater than zero.');
        v_payment_amount := 0;
      ELSE
        v_payment_amount := v_payment_amount_text::numeric;
      END IF;
    ELSE
      v_payment_amount := 0;
    END IF;

    IF v_voucher <> '' AND v_voucher !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$' THEN
      row_errors := array_append(row_errors, 'Voucher number contains invalid characters.');
    END IF;
    IF v_voucher <> '' AND EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.user_id = auth.uid() AND lower(p.voucher_number) = lower(v_voucher)
      LIMIT 1
    ) THEN row_errors := array_append(row_errors, 'Voucher number already exists.'); END IF;

    IF COALESCE(array_length(row_errors, 1), 0) > 0 THEN
      errors := errors || jsonb_build_array(jsonb_build_object('row', row_no + 1, 'errors', to_jsonb(row_errors)));
      CONTINUE;
    END IF;

    BEGIN
      v_result := public.create_member_dues(
        v_name, v_phone, v_amount, v_month, v_year, v_all_months, v_status,
        v_payment_amount, v_date, v_mode, NULLIF(v_voucher, ''), false, ''
      );
      created_count := COALESCE((v_result ->> 'created_count')::integer, 0);
      skipped_count := COALESCE((v_result ->> 'skipped_count')::integer, 0);
      imported_count := imported_count + created_count;
      IF created_count = 0 AND skipped_count > 0 THEN
        errors := errors || jsonb_build_array(jsonb_build_object('row', row_no + 1, 'errors', jsonb_build_array('Member already exists for the selected contribution period.')));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      errors := errors || jsonb_build_array(jsonb_build_object('row', row_no + 1, 'errors', jsonb_build_array(SQLERRM)));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'imported_count', imported_count,
    'failed_count', jsonb_array_length(errors),
    'errors', errors
  );
END;
$$;

-- New accounting tables keep the same account/session protection as existing data.
ALTER TABLE public.member_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own member identities" ON public.member_identities;
CREATE POLICY "Users manage own member identities" ON public.member_identities
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Active device required for member identities" ON public.member_identities;
CREATE POLICY "Active device required for member identities"
  ON public.member_identities AS RESTRICTIVE FOR ALL TO authenticated
  USING ((select public.is_current_device_session()))
  WITH CHECK ((select public.is_current_device_session()));

DROP POLICY IF EXISTS "Users manage own payment allocations" ON public.payment_allocations;
CREATE POLICY "Users manage own payment allocations" ON public.payment_allocations
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "Active device required for payment allocations" ON public.payment_allocations;
CREATE POLICY "Active device required for payment allocations"
  ON public.payment_allocations AS RESTRICTIVE FOR ALL TO authenticated
  USING ((select public.is_current_device_session()))
  WITH CHECK ((select public.is_current_device_session()));

-- Writes go through the checked ledger procedures so a due update cannot silently
-- overwrite an immutable payment transaction or bypass allocation validation.
REVOKE INSERT, UPDATE, DELETE ON public.members FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.payments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.payment_allocations FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.receipts FROM authenticated;
GRANT SELECT ON public.members, public.payments, public.payment_allocations, public.receipts, public.member_identities TO authenticated;

GRANT EXECUTE ON FUNCTION public.require_active_ledger_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_member_dues(text, text, numeric, integer, integer, boolean, text, numeric, date, text, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_member_payment(uuid, numeric, date, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_monthly_due(uuid, text, text, numeric, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_monthly_due(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_monthly_due_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ledger_members() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ledger_payments() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ledger_dashboard_summary(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_payment_receipt(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_import_members(jsonb) TO authenticated;

COMMIT;
