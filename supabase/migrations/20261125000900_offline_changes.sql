begin;
create table public.casa_applied_changes (
 user_id uuid not null references auth.users on delete cascade,
 change_id uuid not null,
 applied_at timestamptz not null default now(),
 primary key(user_id,change_id)
);
alter table public.casa_applied_changes enable row level security;
revoke all on public.casa_applied_changes from anon,authenticated;
grant select,insert(user_id,change_id) on public.casa_applied_changes to authenticated;
create policy changes_owned on public.casa_applied_changes for all to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
grant insert(id) on public.casa_entries,public.casa_boards,public.casa_board_cards,public.casa_list_templates,public.casa_routines to authenticated;

create function public.casa_replay_change(owner_id uuid, change_id uuid, h uuid, action text, entity text, record_id uuid, payload jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare
 saved integer;
 columns text;
 projections text;
 data jsonb;
 row_data jsonb;
begin
 if auth.uid() is distinct from owner_id or not casa_private.is_member(h) then
  raise exception 'Membership required' using errcode='42501';
 end if;
 insert into public.casa_applied_changes as a(user_id,change_id)
 values(owner_id,change_id) on conflict on constraint casa_applied_changes_pkey do nothing;
 if not found then return; end if;
 if action='routineDay' then
  perform public.casa_set_routine_day(h,record_id,(payload->>'day')::date,payload->>'status',(payload->>'assignee')::uuid);
  return;
 end if;
 if action='withdrawLocation' then
  perform public.casa_withdraw_location(h);
  return;
 end if;
 if entity not in ('casa_entries','casa_boards','casa_board_cards','casa_list_templates','casa_routines') or entity is null then
  raise exception 'Unknown offline table';
 end if;
 if action='batch' and entity='casa_entries' then
  if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 50
   or payload->>'kind' not in ('task','shopping') or length(trim(payload->>'category')) not between 1 and 80 then
   raise exception 'Invalid list template';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(h::text||':'||(payload->>'kind')||':'||lower(payload->>'category'),0));
  if exists(select from public.casa_entries e where e.household_id=h and e.kind=payload->>'kind'
   and lower(e.category)=lower(payload->>'category') and not e.archived) then
   raise exception 'List name already in use';
  end if;
  for row_data in select value from jsonb_array_elements(payload->'items') loop
   insert into public.casa_entries(id,household_id,kind,title,category)
   values((row_data->>'id')::uuid,h,payload->>'kind',row_data->>'title',payload->>'category');
  end loop;
  return;
 end if;
 if jsonb_typeof(payload) is distinct from 'object' then raise exception 'Invalid offline data'; end if;
 data=payload - 'id' - 'household_id';
 if action='insert' then
  data=data||jsonb_build_object('id',record_id,'household_id',h);
 end if;
 select string_agg(format('%I',k),',' order by k),string_agg(format('r.%I',k),',' order by k)
 into columns,projections from jsonb_object_keys(data) k;
 if columns is null then raise exception 'Empty offline change'; end if;
 if action='insert' then
  execute format('insert into public.%1$I (%2$s) select %3$s from jsonb_populate_record(null::public.%1$I,$1) r',
   entity,columns,projections) using data;
 elsif action='update' then
  execute format('update public.%1$I set (%2$s)=(select %3$s from jsonb_populate_record(null::public.%1$I,$1) r) where id=$2 and household_id=$3',
   entity,columns,projections) using data,record_id,h;
 else
  raise exception 'Unknown offline action';
 end if;
 get diagnostics saved=row_count;
 if saved<>1 then raise exception 'Offline record no longer exists'; end if;
end $$;
revoke all on function public.casa_replay_change(uuid,uuid,uuid,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.casa_replay_change(uuid,uuid,uuid,text,text,uuid,jsonb) to authenticated;
commit;
