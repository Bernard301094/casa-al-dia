begin;
alter table public.casa_entries drop constraint casa_entries_kind_check;
alter table public.casa_entries add constraint casa_entries_kind_check check (kind in (
 'event','task','shopping','meal','expense','note','message','pet','recipe','contact','birthday','schedule','budget',
 'photo','document','location','deadline','notice'
));
alter table public.casa_entries add column settled boolean not null default false;
grant update(settled) on public.casa_entries to authenticated;
alter table public.casa_entries add constraint casa_deadline_date check (kind<>'deadline' or entry_date is not null);
commit;
