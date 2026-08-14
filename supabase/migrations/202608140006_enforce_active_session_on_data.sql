BEGIN;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active device required for profiles" ON public.profiles;
CREATE POLICY "Active device required for profiles"
  ON public.profiles AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_current_device_session())
  WITH CHECK (public.is_current_device_session());

DROP POLICY IF EXISTS "Active device required for members" ON public.members;
CREATE POLICY "Active device required for members"
  ON public.members AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_current_device_session())
  WITH CHECK (public.is_current_device_session());

DROP POLICY IF EXISTS "Active device required for settings" ON public.org_settings;
CREATE POLICY "Active device required for settings"
  ON public.org_settings AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_current_device_session())
  WITH CHECK (public.is_current_device_session());

DROP POLICY IF EXISTS "Active device required for receipts" ON public.receipts;
CREATE POLICY "Active device required for receipts"
  ON public.receipts AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_current_device_session())
  WITH CHECK (public.is_current_device_session());

DROP POLICY IF EXISTS "Active device required for payments" ON public.payments;
CREATE POLICY "Active device required for payments"
  ON public.payments AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_current_device_session())
  WITH CHECK (public.is_current_device_session());

COMMIT;
