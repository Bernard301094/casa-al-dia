begin;
alter table public.casa_entries
  add column flow jsonb not null default '{}'::jsonb,
  add column deadline_days smallint[],
  add constraint casa_flow_object check (jsonb_typeof(flow)='object' and octet_length(flow::text)<=2048),
  add constraint casa_deadline_days check (deadline_days is null or (
    kind='deadline' and cardinality(deadline_days)<=5 and array_position(deadline_days,null) is null
    and deadline_days <@ array[0,1,3,7,30]::smallint[]
  ));
grant insert(flow,deadline_days),update(flow,deadline_days) on public.casa_entries to authenticated;

create or replace function public.casa_claim_deadline_push()
returns table(token text,entry_id uuid,send_at timestamptz)
language sql security definer set search_path='' as $$
 with due as (
  select d.token,e.id as entry_id,s.send_at
  from public.casa_push_devices d
  join public.casa_members m on m.user_id=d.user_id
  join public.casa_entries e on e.household_id=m.household_id
  cross join lateral (
    select distinct day_offset from unnest(coalesce(e.deadline_days,array[e.deadline_notice])) offset_days(day_offset)
    where day_offset is not null
  ) offsets
  cross join lateral (
    select ((e.entry_date-offsets.day_offset)+coalesce(e.entry_time,time '09:00')) at time zone d.timezone as send_at
  ) s
  where e.kind='deadline' and not e.archived and not e.done
   and (e.assignee is null or e.assignee=d.user_id)
   and s.send_at between now()-interval '10 minutes' and now()
   and not exists(select from public.casa_deadline_deliveries p where p.token=d.token and p.entry_id=e.id
     and p.send_at=s.send_at and (p.sent_at is not null or p.claimed_until>now()))
  order by s.send_at limit 50
 )
 insert into public.casa_deadline_deliveries as delivery(token,entry_id,send_at,claimed_until)
 select due.token,due.entry_id,due.send_at,now()+interval '3 minutes' from due
 on conflict on constraint casa_deadline_deliveries_pkey do update set claimed_until=excluded.claimed_until
 where delivery.sent_at is null and delivery.claimed_until<=now()
 returning delivery.token,delivery.entry_id,delivery.send_at;
$$;
notify pgrst, 'reload schema';
commit;
