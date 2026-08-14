BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

ALTER TABLE public.org_settings
  ADD COLUMN IF NOT EXISTS voucher_seq integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS theme_preference text NOT NULL DEFAULT 'light'
    CHECK (theme_preference IN ('light', 'dark', 'liquid_glass'));

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  voucher_number text NOT NULL,
  payment_date date NOT NULL DEFAULT current_date,
  amount numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
  payment_status text NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid', 'unpaid', 'pending')),
  payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'account')),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, member_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_user_voucher_number_unique_idx
  ON public.payments (user_id, lower(voucher_number));
CREATE UNIQUE INDEX IF NOT EXISTS members_user_voucher_number_unique_idx
  ON public.members (user_id, lower(voucher_number))
  WHERE voucher_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_user_payment_date_idx
  ON public.payments (user_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS payments_member_payment_date_idx
  ON public.payments (member_id, payment_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own payments" ON public.payments;
CREATE POLICY "Users manage own payments" ON public.payments
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_payments_updated ON public.payments;
CREATE TRIGGER trg_payments_updated
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.next_voucher_number(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE next_seq integer;
BEGIN
  INSERT INTO public.org_settings (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.org_settings
  SET voucher_seq = voucher_seq + 1
  WHERE user_id = p_user_id
  RETURNING voucher_seq INTO next_seq;

  RETURN 'VCH-' || lpad(next_seq::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_member_payment_details()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'paid' THEN
    NEW.payment_date := COALESCE(NEW.payment_date, current_date);
    IF NULLIF(btrim(COALESCE(NEW.voucher_number, '')), '') IS NULL THEN
      NEW.voucher_number := public.next_voucher_number(NEW.user_id);
    ELSE
      NEW.voucher_number := btrim(NEW.voucher_number);
    END IF;
  ELSE
    NEW.payment_date := NULL;
    NEW.voucher_number := NULL;
  END IF;
  RETURN NEW;
END;
$$;

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
    ON CONFLICT (user_id, member_id) DO UPDATE SET
      voucher_number = EXCLUDED.voucher_number,
      payment_date = EXCLUDED.payment_date,
      amount = EXCLUDED.amount,
      payment_status = EXCLUDED.payment_status,
      payment_method = EXCLUDED.payment_method;
  ELSE
    UPDATE public.payments
    SET payment_status = NEW.status
    WHERE user_id = NEW.user_id AND member_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_members_prepare_payment ON public.members;
CREATE TRIGGER trg_members_prepare_payment
  BEFORE INSERT OR UPDATE OF status, payment_date, voucher_number, amount, payment_mode
  ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.prepare_member_payment_details();

DROP TRIGGER IF EXISTS trg_members_sync_payment ON public.members;
CREATE TRIGGER trg_members_sync_payment
  AFTER INSERT OR UPDATE OF status, payment_date, voucher_number, amount, payment_mode
  ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.sync_member_payment_record();

COMMENT ON COLUMN public.org_settings.theme_preference IS 'Account-wide UI preference: light, dark, or liquid_glass.';
COMMENT ON COLUMN public.payments.voucher_number IS 'Account-scoped, database-enforced unique payment voucher reference.';

COMMIT;
