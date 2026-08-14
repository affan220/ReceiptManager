BEGIN;

CREATE OR REPLACE FUNCTION public.auto_confirm_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
  IF NEW.email LIKE '%@masjid.local' THEN
    UPDATE auth.users
    SET email_confirmed_at = now()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
