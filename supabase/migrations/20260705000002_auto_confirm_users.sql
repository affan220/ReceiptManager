-- ============================================================
-- CRITICAL FIX: Auto-confirm users on signup so Supabase never
-- tries to send a confirmation email to fake @masjid.local addresses.
--
-- Run this in:  Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- This trigger fires immediately after a new user is inserted into
-- auth.users and sets email_confirmed_at = now(), which marks the
-- account as confirmed without Supabase ever sending an email.
CREATE OR REPLACE FUNCTION public.auto_confirm_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
  -- Only auto-confirm accounts that use our internal @masjid.local domain
  IF NEW.email LIKE '%@masjid.local' THEN
    UPDATE auth.users
    SET
      email_confirmed_at = NOW(),
      confirmed_at       = NOW()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- Drop old trigger if it exists, then re-create
DROP TRIGGER IF EXISTS on_auth_user_auto_confirm ON auth.users;

CREATE TRIGGER on_auth_user_auto_confirm
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_confirm_user();

-- ============================================================
-- ALSO run this to fix any existing users who are stuck in
-- "unconfirmed" state (run once, safe to re-run):
-- ============================================================
UPDATE auth.users
SET
  email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
  confirmed_at       = COALESCE(confirmed_at, NOW())
WHERE email LIKE '%@masjid.local';
