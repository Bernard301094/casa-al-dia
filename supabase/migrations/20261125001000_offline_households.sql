begin;
create function public.casa_create_household_queued(owner_id uuid, h uuid, house_name text, member_name text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.uid() is distinct from owner_id then
   raise exception 'Authentication required' using errcode='42501';
 end if;
 insert into public.casa_households(id,name) values(h,trim(house_name)) on conflict(id) do nothing;
 if found then
  insert into public.casa_members(household_id,user_id,name,role) values(h,owner_id,trim(member_name),'owner');
 elsif not casa_private.is_member(h,true) then
  raise exception 'Household ID already in use' using errcode='42501';
 end if;
end $$;
revoke all on function public.casa_create_household_queued(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.casa_create_household_queued(uuid,uuid,text,text) to authenticated;
commit;
