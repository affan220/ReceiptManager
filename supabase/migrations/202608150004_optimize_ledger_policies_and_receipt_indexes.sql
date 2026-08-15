BEGIN;

-- Cover receipt foreign keys used by receipt history and payment receipt lookups.
CREATE INDEX IF NOT EXISTS receipts_member_id_idx ON public.receipts (member_id);
CREATE INDEX IF NOT EXISTS receipts_payment_id_idx ON public.receipts (payment_id) WHERE payment_id IS NOT NULL;

-- Consolidate legacy overlapping policies. The restrictive active-device policies stay
-- intact; these permissive policies retain same-account access and use init-plan-safe
-- auth lookups. Direct financial writes remain revoked and are handled by RPCs.
DROP POLICY IF EXISTS "Users can view own members" ON public.members;
DROP POLICY IF EXISTS "Users can insert own members" ON public.members;
DROP POLICY IF EXISTS "Users can update own members" ON public.members;
DROP POLICY IF EXISTS "Users can delete own members" ON public.members;
DROP POLICY IF EXISTS "Users manage own members" ON public.members;
CREATE POLICY "Users view own members" ON public.members
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users manage own profile" ON public.profiles
  FOR ALL TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users manage own settings" ON public.org_settings;
CREATE POLICY "Users manage own settings" ON public.org_settings
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own payments" ON public.payments;
CREATE POLICY "Users view own payments" ON public.payments
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own receipts" ON public.receipts;
CREATE POLICY "Users view own receipts" ON public.receipts
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

COMMIT;
