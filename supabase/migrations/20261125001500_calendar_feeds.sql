begin;
create table public.casa_calendar_feeds (
 household_id uuid not null, user_id uuid not null,
 token uuid not null unique default gen_random_uuid(),
 primary key(household_id,user_id),
 foreign key(household_id,user_id) references public.casa_members(household_id,user_id) on delete cascade
);
alter table public.casa_calendar_feeds enable row level security;
revoke all on public.casa_calendar_feeds from anon,authenticated;
grant select,delete,insert(household_id,user_id) on public.casa_calendar_feeds to authenticated;
create policy calendar_feed_owner on public.casa_calendar_feeds for all to authenticated
using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

create function public.casa_read_calendar_feed(code uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('name',h.name,'events',coalesce((
   select jsonb_agg(to_jsonb(event)) from (
     select e.id,e.title,e.entry_date,e.entry_time,e.created_at
     from public.casa_entries e
     where e.household_id=f.household_id and e.kind='event' and not e.archived
       and e.entry_date between current_date-90 and current_date+730
     order by e.entry_date,e.id limit 3000
   ) event
 ),'[]'::jsonb))
 from public.casa_calendar_feeds f
 join public.casa_households h on h.id=f.household_id
 where f.token=code;
$$;
revoke all on function public.casa_read_calendar_feed(uuid) from public,anon,authenticated;
grant execute on function public.casa_read_calendar_feed(uuid) to service_role;
commit;
