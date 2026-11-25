begin;
create function public.casa_withdraw_location(h uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not casa_private.is_member(h) then raise exception 'Membership required'; end if;
 update public.casa_entries set archived=true
 where household_id=h and author=(select auth.uid()) and kind='location' and not archived;
end $$;
revoke all on function public.casa_withdraw_location(uuid) from public, anon, authenticated;
grant execute on function public.casa_withdraw_location(uuid) to authenticated;
commit;
