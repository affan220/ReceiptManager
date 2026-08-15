BEGIN;

-- Receipt sequence advancement is internal to create_payment_receipt and must not be
-- callable directly from browser clients.
REVOKE EXECUTE ON FUNCTION public.next_receipt_number() FROM PUBLIC, anon, authenticated;

COMMIT;
