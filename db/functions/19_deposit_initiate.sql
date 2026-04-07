-- User: initiate STK deposit; no wallet changes
CREATE OR REPLACE FUNCTION public.deposit_initiate(p_amount_cents INTEGER, p_phone TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_deposit_id UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RAISE EXCEPTION 'INVALID_PHONE';
  END IF;

  INSERT INTO public.deposits (user_id, phone, amount_cents, status, provider, created_at, updated_at)
  VALUES (v_uid, trim(p_phone), p_amount_cents, 'initiated', 'mpesa', now(), now())
  RETURNING id INTO v_deposit_id;

  RETURN v_deposit_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.deposit_initiate(INTEGER, TEXT) TO authenticated;
