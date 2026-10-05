revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
revoke execute on function public.is_admin(uuid) from public, anon;
revoke execute on function public.current_tenant() from public, anon;
revoke execute on function public.is_workspace_member(uuid, uuid) from public, anon;
revoke execute on function public.same_tenant_workspace(uuid, uuid) from public, anon;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function public.is_admin(uuid) to authenticated, service_role;
grant execute on function public.current_tenant() to authenticated, service_role;
grant execute on function public.is_workspace_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.same_tenant_workspace(uuid, uuid) to authenticated, service_role;