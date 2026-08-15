BEGIN;

-- Internal, ungranted helper. It removes only the accounting data belonging to one
-- monthly due. A payment that also covers other months is retained, re-anchored to a
-- surviving allocation, and reduced to its surviving allocated amount.
CREATE OR REPLACE FUNCTION public.purge_monthly_due_and_payments(
  p_due_member_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_due public.members%ROWTYPE;
  v_payment record;
  v_remaining_amount numeric;
  v_remaining_count integer;
  v_anchor_due public.members%ROWTYPE;
BEGIN
  SELECT * INTO v_due
  FROM public.members
  WHERE id = p_due_member_id
    AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Monthly contribution record was not found.';
  END IF;

  -- Process every real payment allocated to this monthly record. The allocation
  -- table is the source of truth for whether a payment is shared with another month.
  FOR v_payment IN
    SELECT p.id, p.user_id, p.member_identity_id, p.payment_date,
           p.payment_method, p.voucher_number
    FROM public.payments p
    JOIN public.payment_allocations a ON a.payment_id = p.id
    WHERE p.user_id = p_user_id
      AND a.monthly_due_id = p_due_member_id
    FOR UPDATE OF p
  LOOP
    SELECT COUNT(*)::integer, COALESCE(SUM(a.allocated_amount), 0)
    INTO v_remaining_count, v_remaining_amount
    FROM public.payment_allocations a
    JOIN public.members m ON m.id = a.monthly_due_id
    WHERE a.payment_id = v_payment.id
      AND a.monthly_due_id <> p_due_member_id
      AND m.deleted_at IS NULL;

    IF v_remaining_count = 0 THEN
      -- This payment existed solely for the deleted month. Remove its receipt,
      -- allocation, and payment so it cannot remain in collection/cash/account totals.
      DELETE FROM public.receipts
      WHERE user_id = p_user_id
        AND payment_id = v_payment.id;
      DELETE FROM public.payments
      WHERE id = v_payment.id
        AND user_id = p_user_id;
    ELSE
      -- A single payment can be intentionally allocated across months. Keep its
      -- surviving portions only, move its anchor/receipt to a surviving month, and
      -- reduce its actual money amount so monthly/yearly totals stay exact.
      SELECT m.* INTO v_anchor_due
      FROM public.payment_allocations a
      JOIN public.members m ON m.id = a.monthly_due_id
      WHERE a.payment_id = v_payment.id
        AND a.monthly_due_id <> p_due_member_id
        AND m.deleted_at IS NULL
      ORDER BY m.year, m.month, m.created_at
      LIMIT 1
      FOR UPDATE OF m;

      UPDATE public.payments
      SET member_id = v_anchor_due.id,
          member_identity_id = v_anchor_due.member_identity_id,
          amount = v_remaining_amount
      WHERE id = v_payment.id
        AND user_id = p_user_id;

      UPDATE public.receipts
      SET member_id = v_anchor_due.id,
          month = v_anchor_due.month,
          year = v_anchor_due.year,
          amount = v_remaining_amount,
          voucher_number = v_payment.voucher_number,
          payment_date = v_payment.payment_date,
          payment_method = v_payment.payment_method
      WHERE user_id = p_user_id
        AND payment_id = v_payment.id;

      DELETE FROM public.payment_allocations
      WHERE payment_id = v_payment.id
        AND monthly_due_id = p_due_member_id;
    END IF;
  END LOOP;

  -- Legacy or incomplete rows with no allocation still point directly at this due.
  -- The member foreign keys cascade their payments on hard removal; remove receipts
  -- explicitly so no historical-looking document remains for a deleted monthly slot.
  DELETE FROM public.receipts
  WHERE user_id = p_user_id
    AND member_id = p_due_member_id;

  -- Physically release the month slot after the accounting relationships have been
  -- reconciled. The stable member identity intentionally remains for other months.
  DELETE FROM public.members
  WHERE id = p_due_member_id
    AND user_id = p_user_id;
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
  PERFORM public.purge_monthly_due_and_payments(p_due_member_id, v_user_id);
END;
$$;

-- Repair prior soft-deleted monthly records that were hidden but left payment and
-- allocation rows behind. This uses the same reconciliation routine as future deletes.
DO $$
DECLARE rec record;
BEGIN
  FOR rec IN
    SELECT id, user_id
    FROM public.members
    WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at, created_at
  LOOP
    PERFORM public.purge_monthly_due_and_payments(rec.id, rec.user_id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_monthly_due_and_payments(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_monthly_due(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_monthly_due(uuid) TO authenticated;

COMMIT;
