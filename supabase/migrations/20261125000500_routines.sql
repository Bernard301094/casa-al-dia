begin;
create table public.casa_routines (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.casa_households on delete cascade,
 title text not null check (length(trim(title)) between 1 and 160),
 starts_on date not null,
 every_days smallint not null check (every_days in (1,7)),
 first_member uuid references auth.users on delete set null,
 second_member uuid references auth.users on delete set null,
 due_time time,
 reminder_minutes smallint check (reminder_minutes in (0,15,30,60)),
 archived boolean not null default false,
 unique (household_id,id),
 check (reminder_minutes is null or due_time is not null),
 check (second_member is null or first_member is distinct from second_member)
);
create table public.casa_routine_days (
 household_id uuid not null,
 routine_id uuid not null,
 day date not null,
 status text not null check (status in ('pending','done','skipped')),
 assignee uuid references auth.users on delete set null,
 primary key (household_id,routine_id,day),
 foreign key (household_id,routine_id) references public.casa_routines(household_id,id) on delete cascade
);
alter table public.casa_routines enable row level security;
alter table public.casa_routine_days enable row level security;
revoke all on public.casa_routines, public.casa_routine_days from anon,authenticated;
grant select on public.casa_routines,public.casa_routine_days to authenticated;
grant insert (household_id,title,starts_on,every_days,first_member,second_member,due_time,reminder_minutes),update(archived) on public.casa_routines to authenticated;
create policy routine_read on public.casa_routines for select to authenticated using(casa_private.is_member(household_id));
create policy routine_archive on public.casa_routines for update to authenticated
 using(casa_private.is_member(household_id)) with check(casa_private.is_member(household_id));
create policy routine_insert on public.casa_routines for insert to authenticated with check (
 casa_private.is_member(household_id)
 and (first_member is null or exists(select 1 from public.casa_members m where m.household_id=casa_routines.household_id and m.user_id=first_member))
 and (second_member is null or (first_member is not null and exists(select 1 from public.casa_members m where m.household_id=casa_routines.household_id and m.user_id=second_member)))
);
create policy routine_day_read on public.casa_routine_days for select to authenticated using(casa_private.is_member(household_id));
create function public.casa_set_routine_day(h uuid, r uuid, target_day date, next_status text, next_assignee uuid)
returns void language plpgsql security definer set search_path='' as $$
declare template public.casa_routines%rowtype;
begin
 if not casa_private.is_member(h) then raise exception 'Membership required'; end if;
 select * into template from public.casa_routines where household_id=h and id=r and not archived for share;
 if not found or target_day<template.starts_on or (target_day-template.starts_on)%template.every_days<>0 then
  raise exception 'Routine does not occur on this date';
 end if;
 if next_assignee is not null and not exists(select 1 from public.casa_members m where m.household_id=h and m.user_id=next_assignee) then
  raise exception 'Assignee must be a household member';
 end if;
 insert into public.casa_routine_days(household_id,routine_id,day,status,assignee)
 values(h,r,target_day,next_status,next_assignee)
 on conflict(household_id,routine_id,day) do update set status=excluded.status,assignee=excluded.assignee;
end $$;
revoke all on function public.casa_set_routine_day(uuid,uuid,date,text,uuid) from public,anon,authenticated;
grant execute on function public.casa_set_routine_day(uuid,uuid,date,text,uuid) to authenticated;
alter publication supabase_realtime add table public.casa_routines,public.casa_routine_days;
commit;
