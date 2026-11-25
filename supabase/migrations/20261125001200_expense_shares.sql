begin;
alter table public.casa_entries add column expense_shares jsonb;
alter table public.casa_entries add constraint casa_expense_shares_check check (
 expense_shares is null or (kind='expense' and jsonb_typeof(expense_shares)='object' and pg_column_size(expense_shares)<=12000)
);
grant insert(expense_shares),update(expense_shares) on public.casa_entries to authenticated;
commit;
