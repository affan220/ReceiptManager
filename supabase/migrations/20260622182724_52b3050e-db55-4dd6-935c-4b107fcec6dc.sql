
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_receipt_number() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_receipt_number() TO authenticated;
