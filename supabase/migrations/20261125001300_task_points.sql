begin;
alter table public.casa_entries add column points smallint not null default 0;
alter table public.casa_entries add constraint casa_entry_points_check check (points between 0 and 100 and (kind='task' or points=0));
grant insert(points),update(points) on public.casa_entries to authenticated;
commit;
