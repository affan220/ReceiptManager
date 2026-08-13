BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text;

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS payment_date date,
  ADD COLUMN IF NOT EXISTS voucher_number text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique_idx
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

CREATE INDEX IF NOT EXISTS members_user_payment_date_idx
  ON public.members (user_id, payment_date DESC)
  WHERE payment_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  month integer NOT NULL,
  year integer NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('paid', 'unpaid', 'pending')),
  receipt_no text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, receipt_no)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.receipts TO authenticated;
GRANT ALL ON public.receipts TO service_role;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own receipts" ON public.receipts;
CREATE POLICY "Users manage own receipts" ON public.receipts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS receipts_user_created_at_idx
  ON public.receipts (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_username text;
BEGIN
  requested_username := lower(trim(COALESCE(new.raw_user_meta_data ->> 'username', '')));

  IF requested_username = '' THEN
    RAISE EXCEPTION 'A username is required.';
  END IF;

  INSERT INTO public.profiles (id, username)
  VALUES (new.id, requested_username)
  ON CONFLICT (id) DO UPDATE
    SET username = COALESCE(EXCLUDED.username, public.profiles.username);

  INSERT INTO public.org_settings (user_id)
  VALUES (new.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMENT ON COLUMN public.members.payment_date IS 'Date on which the recorded contribution was paid.';
COMMENT ON COLUMN public.members.voucher_number IS 'Reference or voucher number for the recorded payment.';

COMMIT;
