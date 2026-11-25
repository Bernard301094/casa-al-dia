begin;
update storage.buckets
set allowed_mime_types=array_append(allowed_mime_types,'application/gzip')
where id in ('casa-gallery','casa-documents')
  and not ('application/gzip'=any(allowed_mime_types));

-- Compress sufficiently large column values with PostgreSQL TOAST.
alter table public.casa_entries alter column details set compression pglz,
 alter column expense_shares set compression pglz;
alter table public.casa_board_cards alter column details set compression pglz;
alter table public.casa_list_templates alter column items set compression pglz;
commit;
