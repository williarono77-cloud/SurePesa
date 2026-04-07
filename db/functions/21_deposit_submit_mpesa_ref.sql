-- User: submit M-Pesa reference code for manual deposit
CREATE OR REPLACE FUNCTION public.deposit_submit_mpesa_ref(p_deposit_id UUID, p_mpesa_ref TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_deposit public.deposits%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF p_mpesa_ref IS NULL OR trim(p_mpesa_ref) = '' THEN
    RAISE EXCEPTION 'INVALID_REFERENCE';
  END IF;

  SELECT * INTO v_deposit
  FROM public.deposits
  WHERE id = p_deposit_id AND user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEPOSIT_NOT_FOUND';
  END IF;

  IF v_deposit.status NOT IN ('pending_submit', 'initiated') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  UPDATE public.deposits
  SET external_ref = trim(p_mpesa_ref),
      status = 'submitted',
      updated_at = now()
  WHERE id = p_deposit_id;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.deposit_submit_mpesa_ref(UUID, TEXT) TO authenticated;
