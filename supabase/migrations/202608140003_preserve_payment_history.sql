BEGIN;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_user_id_member_id_key;

CREATE OR REPLACE FUNCTION public.sync_member_payment_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'paid' THEN
    INSERT INTO public.payments (
      user_id, member_id, voucher_number, payment_date, amount, payment_status, payment_method
    ) VALUES (
      NEW.user_id, NEW.id, NEW.voucher_number, NEW.payment_date, NEW.amount, NEW.status, NEW.payment_mode
    )
    ON CONFLICT (user_id, voucher_number) DO UPDATE SET
      payment_date = EXCLUDED.payment_date,
      amount = EXCLUDED.amount,
      payment_status = EXCLUDED.payment_status,
      payment_method = EXCLUDED.payment_method;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
