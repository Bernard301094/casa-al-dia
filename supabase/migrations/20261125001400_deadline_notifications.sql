begin;
alter table public.casa_entries drop constraint casa_attachment_check;
alter table public.casa_entries add constraint casa_attachment_check check (
 (kind in ('photo','document','deadline') and attachment_path is not null and attachment_name is not null
   and author is not null and split_part(attachment_path,'/',1)=household_id::text
   and split_part(attachment_path,'/',2)=author::text)
 or (kind not in ('photo','document') and attachment_path is null and attachment_name is null)
);
alter policy casa_files_read on storage.objects using (
 bucket_id in ('casa-gallery','casa-documents') and exists (
 select 1 from public.casa_members m where m.household_id::text=(storage.foldername(name))[1]
 and m.user_id=(select auth.uid())
 and (m.user_id::text=(storage.foldername(name))[2] or exists (
 select 1 from public.casa_entries e where e.household_id=m.household_id
 and e.attachment_path=storage.objects.name and not e.archived
 and ((e.kind='photo' and bucket_id='casa-gallery') or (e.kind in ('document','deadline') and bucket_id='casa-documents'))
 ))));
alter table public.casa_entries add column deadline_notice smallint
 check (deadline_notice is null or (kind='deadline' and deadline_notice in (0,1,3,7)));
grant insert(deadline_notice),update(deadline_notice,attachment_path,attachment_name) on public.casa_entries to authenticated;

create table public.casa_deadline_deliveries (
 token text not null references public.casa_push_devices on delete cascade,
 entry_id uuid not null references public.casa_entries on delete cascade,
 send_at timestamptz not null,
 claimed_until timestamptz not null,
 sent_at timestamptz,
 primary key(token,entry_id,send_at)
);
alter table public.casa_deadline_deliveries enable row level security;
revoke all on public.casa_deadline_deliveries from anon,authenticated;
grant select,update on public.casa_deadline_deliveries to service_role;
create function public.casa_claim_deadline_push() returns table(token text,entry_id uuid,send_at timestamptz)
language sql security definer set search_path='' as $$
 with due as (
  select d.token,e.id as entry_id,s.send_at
  from public.casa_push_devices d
  join public.casa_members m on m.user_id=d.user_id
  join public.casa_entries e on e.household_id=m.household_id
  cross join lateral (select ((e.entry_date-e.deadline_notice)+coalesce(e.entry_time,time '09:00')) at time zone d.timezone as send_at) s
  where e.kind='deadline' and not e.archived and not e.done and e.deadline_notice is not null
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
revoke all on function public.casa_claim_deadline_push() from public,anon,authenticated;
grant execute on function public.casa_claim_deadline_push() to service_role;
commit;
