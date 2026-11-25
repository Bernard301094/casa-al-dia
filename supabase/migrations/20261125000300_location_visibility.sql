begin;
drop policy entries_read on public.casa_entries;
create policy entries_read on public.casa_entries for select to authenticated using (
 casa_private.is_member(household_id) and (
  kind <> 'location' or (not archived and created_at > now() - interval '24 hours')
 )
);
commit;
