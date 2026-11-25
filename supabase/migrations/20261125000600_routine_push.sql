begin;
create table public.casa_push_devices (
 token text primary key check(length(token) between 32 and 1024),
 user_id uuid not null references auth.users on delete cascade,
 timezone text not null,
 updated_at timestamptz not null default now()
);
alter table public.casa_push_devices enable row level security;
revoke all on public.casa_push_devices from anon,authenticated;
grant select,delete on public.casa_push_devices to service_role;
create function public.casa_register_push(device_token text, device_timezone text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if not exists(select from pg_catalog.pg_timezone_names where name=device_timezone) then raise exception 'Invalid timezone'; end if;
 insert into public.casa_push_devices(token,user_id,timezone)
 values(device_token,auth.uid(),device_timezone)
 on conflict(token) do update set user_id=excluded.user_id,timezone=excluded.timezone,updated_at=now();
end $$;
create function public.casa_unregister_push(device_token text) returns void
language sql security definer set search_path='' as $$
 delete from public.casa_push_devices where user_id=auth.uid() and token=device_token;
$$;
revoke all on function public.casa_register_push(text,text),public.casa_unregister_push(text) from public,anon,authenticated;
grant execute on function public.casa_register_push(text,text),public.casa_unregister_push(text) to authenticated;

create table public.casa_push_deliveries (
 token text not null references public.casa_push_devices on delete cascade,
 routine_id uuid not null references public.casa_routines on delete cascade,
 day date not null,
 claimed_until timestamptz not null,
 sent_at timestamptz,
 primary key(token,routine_id,day)
);
alter table public.casa_push_deliveries enable row level security;
revoke all on public.casa_push_deliveries from anon,authenticated;
grant select,update on public.casa_push_deliveries to service_role;
create function public.casa_claim_routine_push() returns table(token text,routine_id uuid,day date)
language sql security definer set search_path='' as $$
 with due as (
  select d.token,r.id as routine_id,x.day
  from public.casa_push_devices d
  join public.casa_members m on m.user_id=d.user_id
  join public.casa_routines r on r.household_id=m.household_id
  cross join lateral (
    select (now() at time zone d.timezone)::date + shifts.shift as day
    from (values(-1),(0),(1)) shifts(shift)
  ) x
  left join public.casa_routine_days exception
    on exception.household_id=r.household_id and exception.routine_id=r.id and exception.day=x.day
  cross join lateral (
    select coalesce(exception.assignee,case when r.second_member is not null and
      ((x.day-r.starts_on)/r.every_days)%2=1 then r.second_member else r.first_member end) as assigned
  ) assignment
  cross join lateral (
    select ((x.day+r.due_time) at time zone d.timezone)-make_interval(mins=>r.reminder_minutes) as send_at
  ) schedule
  where not r.archived and r.reminder_minutes is not null and r.due_time is not null
   and x.day>=r.starts_on and (x.day-r.starts_on)%r.every_days=0
   and coalesce(exception.status,'pending')='pending'
   and (assignment.assigned is null or assignment.assigned=d.user_id or not exists(
     select from public.casa_members a where a.household_id=r.household_id and a.user_id=assignment.assigned))
   and schedule.send_at between now()-interval '10 minutes' and now()
   and not exists(select from public.casa_push_deliveries p where p.token=d.token and p.routine_id=r.id
      and p.day=x.day and (p.sent_at is not null or p.claimed_until>now()))
  order by schedule.send_at
  limit 50
 )
 insert into public.casa_push_deliveries as pending(token,routine_id,day,claimed_until)
 select due.token,due.routine_id,due.day,now()+interval '2 minutes' from due
 on conflict(token,routine_id,day) do update set claimed_until=excluded.claimed_until
 where pending.sent_at is null and pending.claimed_until<=now()
 returning pending.token,pending.routine_id,pending.day;
$$;
revoke all on function public.casa_claim_routine_push() from public,anon,authenticated;
grant execute on function public.casa_claim_routine_push() to service_role;
commit;
