-- ================================================================
-- MASJID RECEIPT MANAGER — COMPLETE DATABASE SETUP
-- 
-- INSTRUCTIONS:
-- 1. Go to: https://supabase.com/dashboard/project/hfhitzyfgzvtfpckazcv/sql/new
-- 2. Select all text in this file (Ctrl+A), copy (Ctrl+C)
-- 3. Paste into the Supabase SQL editor
-- 4. Click the green "Run" button
-- 5. You should see "Success. No rows returned"
-- ================================================================


-- ────────────────────────────────────────────────
-- TABLE: public.profiles
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID        NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     TEXT,
  organization  TEXT,
  phone         TEXT,
  address       TEXT,
  username      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own profile"   ON public.profiles;
DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;

CREATE POLICY "Users view own profile"
  ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users insert own profile"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);


-- ────────────────────────────────────────────────
-- TABLE: public.members
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.members (
  id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  phone          TEXT        NOT NULL DEFAULT '',
  amount         NUMERIC     NOT NULL DEFAULT 0,
  status         TEXT        NOT NULL DEFAULT 'unpaid'
                             CHECK (status IN ('paid', 'unpaid', 'pending')),
  month          INTEGER     NOT NULL,
  year           INTEGER     NOT NULL,
  hold           BOOLEAN     NOT NULL DEFAULT false,
  months_pending INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.members TO authenticated;
GRANT ALL ON public.members TO service_role;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS members_user_id_idx ON public.members(user_id);

DROP POLICY IF EXISTS "Users manage own members" ON public.members;

CREATE POLICY "Users manage own members"
  ON public.members FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ────────────────────────────────────────────────
-- TABLE: public.org_settings
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_settings (
  user_id          UUID        NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL DEFAULT 'My Masjid',
  tagline          TEXT        NOT NULL DEFAULT 'Donation & Receipt Management',
  address          TEXT        NOT NULL DEFAULT '',
  phone            TEXT        NOT NULL DEFAULT '',
  email            TEXT        NOT NULL DEFAULT '',
  logo_data_url    TEXT,
  signature_label  TEXT        NOT NULL DEFAULT 'Authorized Signatory',
  receipt_prefix   TEXT        NOT NULL DEFAULT 'RCPT',
  currency         TEXT        NOT NULL DEFAULT 'Rs',
  receipt_seq      INTEGER     NOT NULL DEFAULT 1000,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_settings TO authenticated;
GRANT ALL ON public.org_settings TO service_role;
ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own settings" ON public.org_settings;

CREATE POLICY "Users manage own settings"
  ON public.org_settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ────────────────────────────────────────────────
-- FUNCTION + TRIGGERS: auto updated_at
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated     ON public.profiles;
DROP TRIGGER IF EXISTS trg_members_updated      ON public.members;
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


-- ────────────────────────────────────────────────
-- FUNCTION + TRIGGER: auto-create profile & settings on signup
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'username')
    ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username;

  INSERT INTO public.org_settings (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ────────────────────────────────────────────────
-- FUNCTION + TRIGGER: auto-confirm @masjid.local accounts
-- (so no confirmation email is ever attempted)
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_confirm_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = auth, public AS $$
BEGIN
  IF NEW.email LIKE '%@masjid.local' THEN
    UPDATE auth.users
    SET email_confirmed_at = NOW(),
        confirmed_at       = NOW()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_auto_confirm ON auth.users;
CREATE TRIGGER on_auth_user_auto_confirm
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.auto_confirm_user();


-- ────────────────────────────────────────────────
-- FUNCTION: atomic receipt number increment
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.next_receipt_number()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE next_seq INTEGER;
BEGIN
  UPDATE public.org_settings
     SET receipt_seq = receipt_seq + 1
   WHERE user_id = auth.uid()
  RETURNING receipt_seq INTO next_seq;
  RETURN next_seq;
END;
$$;


-- ────────────────────────────────────────────────
-- FIX EXISTING USERS (run once, safe to re-run)
-- ────────────────────────────────────────────────

-- Confirm any existing @masjid.local accounts
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
    confirmed_at       = COALESCE(confirmed_at, NOW())
WHERE email LIKE '%@masjid.local';

-- Create profiles for existing users who don't have one
INSERT INTO public.profiles (id, username)
SELECT id, raw_user_meta_data->>'username'
FROM auth.users
WHERE email LIKE '%@masjid.local'
ON CONFLICT (id) DO NOTHING;

-- Create org_settings for existing users who don't have one
INSERT INTO public.org_settings (user_id)
SELECT id FROM auth.users
WHERE email LIKE '%@masjid.local'
ON CONFLICT (user_id) DO NOTHING;
