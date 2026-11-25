begin;
create extension if not exists pg_net;
create extension if not exists pg_cron;
do $$
begin
 if not exists(select 1 from vault.secrets where name='routine_push_secret') then
  perform vault.create_secret(replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),
   'routine_push_secret','Authenticates Casa al Día routine push invocations');
 end if;
end $$;
create function public.casa_verify_push_invocation(candidate text) returns boolean
language sql stable security definer set search_path='' as $$
 select length(candidate)=64 and exists(
  select 1 from vault.decrypted_secrets where name='routine_push_secret' and decrypted_secret=candidate
 );
$$;
revoke all on function public.casa_verify_push_invocation(text) from public,anon,authenticated;
grant execute on function public.casa_verify_push_invocation(text) to service_role;
commit;
