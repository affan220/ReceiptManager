BEGIN;

CREATE OR REPLACE FUNCTION public.sync_member_payment_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_payment_id uuid;
BEGIN
  SELECT id INTO existing_payment_id
  FROM public.payments
  WHERE user_id = NEW.user_id
    AND member_id = NEW.id
  ORDER BY created_at DESC
  LIMIT 1;

  IF NEW.status = 'paid' THEN
    IF existing_payment_id IS NULL THEN
      INSERT INTO public.payments (
        user_id, member_id, voucher_number, payment_date, amount, payment_status, payment_method
      ) VALUES (
        NEW.user_id, NEW.id, NEW.voucher_number, NEW.payment_date, NEW.amount, NEW.status, NEW.payment_mode
      );
    ELSE
      UPDATE public.payments
      SET voucher_number = NEW.voucher_number,
          payment_date = NEW.payment_date,
          amount = NEW.amount,
          payment_status = NEW.status,
          payment_method = NEW.payment_mode
      WHERE id = existing_payment_id;
    END IF;
  ELSIF existing_payment_id IS NOT NULL THEN
    UPDATE public.payments
    SET payment_status = NEW.status
    WHERE id = existing_payment_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
