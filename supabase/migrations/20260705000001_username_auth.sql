-- ============================================================
-- Migration: Username-based auth hardening
-- Run this in the Supabase SQL Editor if not already applied.
-- ============================================================

-- 1. Add a username column to profiles so it's queryable server-side
--    (Supabase already stores it in auth.users.raw_user_meta_data,
--     but having it here lets you do UNIQUE checks and fast lookups.)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username TEXT;

-- Make username unique so duplicate registrations are blocked at DB level
-- (Supabase Auth already returns "User already registered" for duplicate
--  emails, which we map from usernames, but this column adds an extra guard.)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique
  ON public.profiles (username)
  WHERE username IS NOT NULL;

-- 2. Update the handle_new_user() trigger to capture the username
--    from the user's metadata on signup.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, organization, phone, address, username)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'organization',
    NEW.raw_user_meta_data ->> 'phone',
    NEW.raw_user_meta_data ->> 'address',
    NEW.raw_user_meta_data ->> 'username'
  )
  ON CONFLICT (id) DO UPDATE
    SET username = EXCLUDED.username;

  -- Only insert org_settings if it doesn't exist yet
  INSERT INTO public.org_settings (user_id, name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'organization', 'My Masjid'))
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- Verify RLS policies are in place (read-only check, safe to run)
-- ============================================================
-- SELECT schemaname, tablename, policyname, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
