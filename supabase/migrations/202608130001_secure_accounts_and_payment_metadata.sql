BEGIN;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  organization text,
  phone text,
  address text,
  username text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username text;

CREATE TABLE IF NOT EXISTS public.org_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'My Masjid',
  tagline text NOT NULL DEFAULT 'Donation & Receipt Management',
  address text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  logo_data_url text,
  signature_label text NOT NULL DEFAULT 'Authorized Signatory',
  receipt_prefix text NOT NULL DEFAULT 'RCPT',
  currency text NOT NULL DEFAULT '₹',
  receipt_seq integer NOT NULL DEFAULT 1000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS month integer NOT NULL DEFAULT EXTRACT(MONTH FROM now())::integer,
  ADD COLUMN IF NOT EXISTS year integer NOT NULL DEFAULT EXTRACT(YEAR FROM now())::integer,
  ADD COLUMN IF NOT EXISTS hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS months_pending integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'cash' CHECK (payment_mode IN ('cash', 'account')),
  ADD COLUMN IF NOT EXISTS payment_date date,
  ADD COLUMN IF NOT EXISTS voucher_number text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique_idx
  ON public.profiles (lower(username)) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS members_user_id_idx ON public.members(user_id);
CREATE INDEX IF NOT EXISTS members_user_payment_date_idx ON public.members (user_id, payment_date DESC) WHERE payment_date IS NOT NULL;

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
CREATE INDEX IF NOT EXISTS receipts_user_created_at_idx ON public.receipts (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles, public.members, public.org_settings, public.receipts TO authenticated;
GRANT ALL ON public.profiles, public.members, public.org_settings, public.receipts TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users manage own members" ON public.members;
CREATE POLICY "Users manage own members" ON public.members FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own settings" ON public.org_settings;
CREATE POLICY "Users manage own settings" ON public.org_settings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own receipts" ON public.receipts;
CREATE POLICY "Users manage own receipts" ON public.receipts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_profiles_updated ON public.profiles;
DROP TRIGGER IF EXISTS trg_members_updated ON public.members;
DROP TRIGGER IF EXISTS trg_org_settings_updated ON public.org_settings;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_members_updated BEFORE UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_org_settings_updated BEFORE UPDATE ON public.org_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

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

  INSERT INTO public.profiles (id, full_name, organization, phone, address, username)
  VALUES (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'organization',
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'address',
    requested_username
  )
  ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username;

  INSERT INTO public.org_settings (user_id, name)
  VALUES (new.id, COALESCE(new.raw_user_meta_data ->> 'organization', 'My Masjid'))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_confirm_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
  IF new.email LIKE '%@masjid.local' THEN
    UPDATE auth.users SET email_confirmed_at = now() WHERE id = new.id;
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
DROP TRIGGER IF EXISTS on_auth_user_auto_confirm ON auth.users;
CREATE TRIGGER on_auth_user_auto_confirm AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.auto_confirm_user();

CREATE OR REPLACE FUNCTION public.next_receipt_number()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE next_seq integer;
BEGIN
  UPDATE public.org_settings SET receipt_seq = receipt_seq + 1 WHERE user_id = auth.uid() RETURNING receipt_seq INTO next_seq;
  RETURN next_seq;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_receipt_number() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_receipt_number() TO authenticated;

COMMENT ON COLUMN public.members.payment_date IS 'Date on which the recorded contribution was paid.';
COMMENT ON COLUMN public.members.voucher_number IS 'Reference or voucher number for the recorded payment.';

COMMIT;
