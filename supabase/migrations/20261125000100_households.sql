begin;
create schema if not exists casa_private;
create table public.casa_households (
 id uuid primary key default gen_random_uuid(), name text not null check (char_length(trim(name)) between 1 and 80), created_at timestamptz not null default now()
);
create table public.casa_members (
 household_id uuid references public.casa_households on delete cascade, user_id uuid references auth.users on delete cascade,
 name text not null check (char_length(trim(name)) between 1 and 80), role text not null check (role in ('owner','member')),
 primary key(household_id,user_id)
);
create table public.casa_invites (
 token uuid primary key default gen_random_uuid(), household_id uuid not null references public.casa_households on delete cascade,
 expires_at timestamptz not null default now() + interval '7 days'
);
create table public.casa_entries (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.casa_households on delete cascade,
 kind text not null check (kind in ('event','task','shopping','meal','expense','note','message','pet')),
 title text not null check (char_length(trim(title)) between 1 and 160), details text not null default '' check (char_length(details)<=4000),
 category text not null default '' check (char_length(category)<=80), entry_date date, entry_time time, done boolean not null default false,
 amount numeric(12,2) check (amount >= 0), assignee uuid references auth.users on delete set null, author uuid default auth.uid() references auth.users on delete set null,
 created_at timestamptz not null default now(), archived boolean not null default false,
 check (kind not in ('event','meal','expense') or entry_date is not null),
 check (kind <> 'expense' or amount is not null)
);
create index on public.casa_entries(household_id, created_at desc);
create index on public.casa_members(user_id,household_id);
create function casa_private.is_member(h uuid, owner_only boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.casa_members m where m.household_id=h and m.user_id=(select auth.uid()) and (not owner_only or m.role='owner'));
$$;
revoke all on function casa_private.is_member(uuid,boolean) from public;
grant usage on schema casa_private to authenticated;
grant execute on function casa_private.is_member(uuid,boolean) to authenticated;
alter table public.casa_households enable row level security;
alter table public.casa_members enable row level security;
alter table public.casa_invites enable row level security;
alter table public.casa_entries enable row level security;
revoke all on public.casa_households, public.casa_members, public.casa_invites, public.casa_entries from anon, authenticated;
grant select on public.casa_households, public.casa_members, public.casa_entries to authenticated;
grant insert (household_id,kind,title,details,category,entry_date,entry_time,amount,assignee) on public.casa_entries to authenticated;
grant update (title,details,category,entry_date,entry_time,amount,assignee,done,archived) on public.casa_entries to authenticated;
create policy household_read on public.casa_households for select to authenticated using(casa_private.is_member(id));
create policy members_read on public.casa_members for select to authenticated using(casa_private.is_member(household_id));
create policy entries_read on public.casa_entries for select to authenticated using(casa_private.is_member(household_id));
create policy entries_insert on public.casa_entries for insert to authenticated with check(
 casa_private.is_member(household_id) and author=(select auth.uid())
 and (assignee is null or exists(select 1 from public.casa_members m where m.household_id=casa_entries.household_id and m.user_id=casa_entries.assignee))
);
create policy entries_update on public.casa_entries for update to authenticated
using(casa_private.is_member(household_id) and (kind <> 'message' or author=(select auth.uid()) or casa_private.is_member(household_id,true))) with check(
 casa_private.is_member(household_id)
 and (assignee is null or exists(select 1 from public.casa_members m where m.household_id=casa_entries.household_id and m.user_id=casa_entries.assignee))
);
create function public.casa_create_household(house_name text, member_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 insert into public.casa_households(name) values(trim(house_name)) returning id into new_id;
 insert into public.casa_members values(new_id, auth.uid(),trim(member_name),'owner');
 return new_id;
end $$;
create function public.casa_create_invite(h uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare code uuid;
begin
 if not casa_private.is_member(h,true) then raise exception 'Owner access required'; end if;
 insert into public.casa_invites(household_id) values(h) returning token into code;
 return code;
end $$;
create function public.casa_join_household(code uuid, member_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare h uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 delete from public.casa_invites where token=code and expires_at>now() returning household_id into h;
 if h is null then raise exception 'Invalid or expired invitation'; end if;
 insert into public.casa_members values(h,auth.uid(),trim(member_name),'member') on conflict do nothing;
 return h;
end $$;
create function public.casa_remove_member(h uuid, member_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not casa_private.is_member(h,true) then raise exception 'Owner access required'; end if;
 if not exists(select 1 from public.casa_members where household_id=h and user_id=member_id and role='member') then return; end if;
 update public.casa_entries set assignee=null where household_id=h and assignee=member_id;
 delete from public.casa_members where household_id=h and user_id=member_id and role='member';
end $$;
revoke all on function public.casa_create_household(text,text), public.casa_create_invite(uuid), public.casa_join_household(uuid,text), public.casa_remove_member(uuid,uuid) from public, anon, authenticated;
grant execute on function public.casa_create_household(text,text), public.casa_create_invite(uuid), public.casa_join_household(uuid,text), public.casa_remove_member(uuid,uuid) to authenticated;
alter publication supabase_realtime add table public.casa_entries, public.casa_members;
commit;
