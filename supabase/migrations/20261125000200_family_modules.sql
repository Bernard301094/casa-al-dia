begin;
alter table public.casa_entries drop constraint casa_entries_kind_check;
alter table public.casa_entries add constraint casa_entries_kind_check check (kind in (
 'event','task','shopping','meal','expense','note','message','pet','recipe','contact','birthday','schedule','budget','photo','document','location'
));
alter table public.casa_entries add column attachment_path text,
 add column attachment_name text,
 add column latitude double precision check (latitude between -90 and 90),
 add column longitude double precision check (longitude between -180 and 180),
 add constraint casa_location_coordinates check (kind <> 'location' or (latitude is not null and longitude is not null)),
 add constraint casa_extra_required_date check (kind not in ('birthday','schedule','budget') or entry_date is not null),
 add constraint casa_budget_amount check (kind <> 'budget' or amount is not null),
 add constraint casa_attachment_check check (
   (kind in ('photo','document') and attachment_path is not null and attachment_name is not null
     and split_part(attachment_path,'/',1)=household_id::text and split_part(attachment_path,'/',2)=author::text)
   or (kind not in ('photo','document') and attachment_path is null and attachment_name is null)
 );
grant insert (attachment_path,attachment_name,latitude,longitude) on public.casa_entries to authenticated;
drop policy entries_update on public.casa_entries;
create policy entries_update on public.casa_entries for update to authenticated
using(casa_private.is_member(household_id) and (kind not in ('message','location') or author=(select auth.uid()) or casa_private.is_member(household_id,true)))
with check(casa_private.is_member(household_id)
 and (assignee is null or exists(select 1 from public.casa_members m where m.household_id=casa_entries.household_id and m.user_id=casa_entries.assignee)));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values
 ('casa-gallery','casa-gallery',false,20971520,array['image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm','video/quicktime']),
 ('casa-documents','casa-documents',false,20971520,array['application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp']);
create policy casa_files_read on storage.objects for select to authenticated using (
 bucket_id in ('casa-gallery','casa-documents') and exists (
 select 1 from public.casa_members m where m.household_id::text=(storage.foldername(name))[1]
 and m.user_id=(select auth.uid())
 and (m.user_id::text=(storage.foldername(name))[2] or exists (
 select 1 from public.casa_entries e where e.household_id=m.household_id
 and e.attachment_path=storage.objects.name and not e.archived
 and ((e.kind='photo' and bucket_id='casa-gallery') or (e.kind='document' and bucket_id='casa-documents'))
 ))));
create policy casa_files_insert on storage.objects for insert to authenticated with check (
 bucket_id in ('casa-gallery','casa-documents') and (storage.foldername(name))[2]=(select auth.uid())::text
 and exists(select 1 from public.casa_members m where m.household_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid())));
create policy casa_files_cleanup on storage.objects for delete to authenticated using (
 bucket_id in ('casa-gallery','casa-documents') and (storage.foldername(name))[2]=(select auth.uid())::text
 and exists(select 1 from public.casa_members m where m.household_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid()))
 and not exists(select 1 from public.casa_entries e where e.attachment_path=storage.objects.name and not e.archived));
create table public.casa_activity (
 id bigint generated always as identity primary key, household_id uuid not null references public.casa_households on delete cascade,
 actor uuid references auth.users on delete set null, kind text not null, action text not null, created_at timestamptz not null default now()
);
create index on public.casa_activity(household_id, created_at desc);
alter table public.casa_activity enable row level security;
revoke all on public.casa_activity from anon, authenticated;
grant select on public.casa_activity to authenticated;
create policy casa_activity_read on public.casa_activity for select to authenticated using(casa_private.is_member(household_id));
create function casa_private.log_entry() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is not null then
  insert into public.casa_activity(household_id,actor,kind,action)
  values(new.household_id,(select auth.uid()),new.kind,
   case when TG_OP='INSERT' then 'created' when new.archived and not old.archived then 'archived'
   when new.done and not old.done then 'completed' else 'updated' end);
 end if;
 return new;
end $$;
revoke all on function casa_private.log_entry() from public;
create trigger casa_activity_entry after insert or update on public.casa_entries for each row execute function casa_private.log_entry();
commit;
