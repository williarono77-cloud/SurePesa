-- Admin read for wallets (run after 08_wallets_rls.sql)
-- Admins can SELECT all wallets for platform stats (e.g. total balance).

DROP POLICY IF EXISTS wallets_admin_select ON public.wallets;
CREATE POLICY wallets_admin_select
  ON public.wallets FOR SELECT
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
