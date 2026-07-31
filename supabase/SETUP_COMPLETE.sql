-- ================================================================
-- MASJID RECEIPT MANAGER — COMPLETE SUPABASE SETUP
-- Paste this into Supabase SQL Editor and run it.
-- ================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  organization TEXT,
  phone TEXT,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;

CREATE POLICY "Users view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- 2) members
CREATE TABLE IF NOT EXISTS public.members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('paid', 'unpaid', 'pending')),
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  hold BOOLEAN NOT NULL DEFAULT false,
  months_pending INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.members TO authenticated;
GRANT ALL ON public.members TO service_role;
CREATE INDEX IF NOT EXISTS members_user_id_idx ON public.members(user_id);

DROP POLICY IF EXISTS "Users manage own members" ON public.members;
CREATE POLICY "Users manage own members"
  ON public.members FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own members"
  ON public.members FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own members"
  ON public.members FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own members"
  ON public.members FOR DELETE
  USING (auth.uid() = user_id);

-- 3) org_settings
CREATE TABLE IF NOT EXISTS public.org_settings (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'My Masjid',
  tagline TEXT NOT NULL DEFAULT 'Donation & Receipt Management',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  logo_data_url TEXT,
  signature_label TEXT NOT NULL DEFAULT 'Authorized Signatory',
  receipt_prefix TEXT NOT NULL DEFAULT 'RCPT',
  currency TEXT NOT NULL DEFAULT '₹',
  receipt_seq INTEGER NOT NULL DEFAULT 1000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_settings TO authenticated;
GRANT ALL ON public.org_settings TO service_role;

DROP POLICY IF EXISTS "Users manage own settings" ON public.org_settings;
CREATE POLICY "Users view own settings"
  ON public.org_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own settings"
  ON public.org_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own settings"
  ON public.org_settings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own settings"
  ON public.org_settings FOR DELETE
  USING (auth.uid() = user_id);

-- 4) updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated ON public.profiles;
DROP TRIGGER IF EXISTS trg_members_updated ON public.members;
DROP TRIGGER IF EXISTS trg_org_settings_updated ON public.org_settings;

CREATE TRIGGER trg_profiles_updated
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_members_updated
  BEFORE UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_org_settings_updated
  BEFORE UPDATE ON public.org_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5) create profile/settings rows for new auth users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, organization, phone, address)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'organization',
    NEW.raw_user_meta_data ->> 'phone',
    NEW.raw_user_meta_data ->> 'address'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.org_settings (user_id, name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'organization', 'My Masjid'))
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6) receipt number function used by print center
CREATE OR REPLACE FUNCTION public.next_receipt_number()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE next_seq INTEGER;
BEGIN
  UPDATE public.org_settings
     SET receipt_seq = receipt_seq + 1
   WHERE user_id = auth.uid()
  RETURNING receipt_seq INTO next_seq;

  IF next_seq IS NULL THEN
    INSERT INTO public.org_settings (user_id)
    VALUES (auth.uid())
    ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.org_settings
       SET receipt_seq = receipt_seq + 1
     WHERE user_id = auth.uid()
    RETURNING receipt_seq INTO next_seq;
  END IF;

  RETURN COALESCE(next_seq, 1000);
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_receipt_number() TO authenticated;

-- 7) backfill existing users
INSERT INTO public.profiles (id)
SELECT id FROM auth.users
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.org_settings (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
