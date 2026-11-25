-- Run once after configuring the Edge Function and its corresponding Vault secrets.
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
begin
 if not exists(select 1 from vault.secrets where name='routine_push_secret')
 or not exists(select 1 from vault.secrets where name='routine_push_project_url') then
  raise exception 'Configure routine_push_secret and routine_push_project_url in Vault first';
 end if;
end $$;
select cron.schedule('casa-routine-push','* * * * *', $job$
 select net.http_post(
   url := (select decrypted_secret from vault.decrypted_secrets where name='routine_push_project_url') || '/functions/v1/routine-push',
   headers := jsonb_build_object(
     'Content-Type','application/json',
     'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='routine_push_secret')
   ),
   body := '{}'::jsonb,
   timeout_milliseconds := 70000
 );
$job$);
