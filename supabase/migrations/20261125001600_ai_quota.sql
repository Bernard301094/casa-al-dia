begin;
create table casa_private.ai_daily (
 user_id uuid not null references auth.users on delete cascade,
 day date not null,
 used integer not null,
 primary key(user_id,day)
);
create function public.casa_claim_ai(h uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not casa_private.is_member(h) then return false; end if;
 insert into casa_private.ai_daily as usage(user_id,day,used) values(auth.uid(),current_date,1)
 on conflict(user_id,day) do update set used=usage.used+1 where usage.used<15;
 return found;
end $$;
revoke all on function public.casa_claim_ai(uuid) from public,anon,authenticated;
grant execute on function public.casa_claim_ai(uuid) to authenticated;
commit;
