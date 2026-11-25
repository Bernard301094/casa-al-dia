begin;
create table public.casa_boards (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.casa_households on delete cascade,
 title text not null check(length(trim(title)) between 1 and 80),
 archived boolean not null default false,
 unique(household_id,id)
);
create table public.casa_board_cards (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null,
 board_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 160),
 details text not null default '' check(length(details)<=4000),
 stage text not null default 'todo' check(stage in ('todo','doing','done')),
 assignee uuid references auth.users on delete set null,
 due_date date,
 archived boolean not null default false,
 created_at timestamptz not null default now(),
 foreign key(household_id,board_id) references public.casa_boards(household_id,id) on delete cascade
);
create index on public.casa_board_cards(household_id,board_id,created_at);
create table public.casa_list_templates (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.casa_households on delete cascade,
 title text not null check(length(trim(title)) between 1 and 80),
 kind text not null check(kind in ('task','shopping')),
 items text[] not null check(cardinality(items) between 1 and 50 and length(array_to_string(items, E'\n'))<=8000),
 archived boolean not null default false
);
create index on public.casa_list_templates(household_id);
alter table public.casa_boards enable row level security;
alter table public.casa_board_cards enable row level security;
alter table public.casa_list_templates enable row level security;
revoke all on public.casa_boards,public.casa_board_cards,public.casa_list_templates from anon,authenticated;
grant select on public.casa_boards,public.casa_board_cards,public.casa_list_templates to authenticated;
grant insert(household_id,title),update(title,archived) on public.casa_boards to authenticated;
grant insert(household_id,board_id,title,details,stage,assignee,due_date),
 update(title,details,stage,assignee,due_date,archived) on public.casa_board_cards to authenticated;
grant insert(household_id,title,kind,items),update(title,kind,items,archived) on public.casa_list_templates to authenticated;
create policy boards_member on public.casa_boards for all to authenticated
 using(casa_private.is_member(household_id)) with check(casa_private.is_member(household_id));
create policy templates_member on public.casa_list_templates for all to authenticated
 using(casa_private.is_member(household_id)) with check(casa_private.is_member(household_id));
create policy cards_read on public.casa_board_cards for select to authenticated using(casa_private.is_member(household_id));
create policy cards_insert on public.casa_board_cards for insert to authenticated with check (
 exists(select from public.casa_boards b where b.id=board_id and b.household_id=casa_board_cards.household_id and not b.archived)
 and (assignee is null or exists(select from public.casa_members m where m.household_id=casa_board_cards.household_id and m.user_id=assignee)));
create policy cards_update on public.casa_board_cards for update to authenticated using(
 exists(select from public.casa_boards b where b.id=board_id and b.household_id=casa_board_cards.household_id and not b.archived))
 with check (assignee is null or exists(select from public.casa_members m where m.household_id=casa_board_cards.household_id and m.user_id=assignee));
create function public.casa_copy_list_template(h uuid, template_id uuid, list_name text) returns integer
language plpgsql security invoker set search_path='' as $$
declare v public.casa_list_templates%rowtype; copied integer;
begin
 list_name=trim(list_name);
 if list_name is null or length(list_name) not between 1 and 80 then raise exception 'Invalid list name'; end if;
 select * into v from public.casa_list_templates where household_id=h and id=template_id and not archived;
 if not found then raise exception 'Template unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(h::text||':'||v.kind||':'||lower(list_name),0));
 if exists(select from public.casa_entries where household_id=h and kind=v.kind and lower(category)=lower(list_name) and not archived) then
  raise exception 'List name already in use';
 end if;
 insert into public.casa_entries(household_id,kind,title,category)
 select h,v.kind,trim(label),list_name from unnest(v.items) label;
 get diagnostics copied=row_count;
 return copied;
end $$;
revoke all on function public.casa_copy_list_template(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.casa_copy_list_template(uuid,uuid,text) to authenticated;
alter publication supabase_realtime add table public.casa_boards,public.casa_board_cards,public.casa_list_templates;
commit;
