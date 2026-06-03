
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.has_role(uuid, public.app_role, uuid) from public, anon;
revoke execute on function public.current_paroquia_id() from public, anon;
