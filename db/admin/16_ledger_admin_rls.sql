-- Admin read-only for ledger (run after 11_ledger_rls.sql)
-- Admins can SELECT all ledger entries; no INSERT, UPDATE, DELETE.

DROP POLICY IF EXISTS ledger_admin_select ON public.ledger;

CREATE POLICY ledger_admin_select
  ON public.ledger FOR SELECT
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );
