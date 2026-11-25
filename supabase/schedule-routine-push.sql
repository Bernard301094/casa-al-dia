-- Run once the Firebase service account secret is available.
select cron.schedule('casa-routine-push','* * * * *', $job$
 select net.http_post(
   url := 'https://cuocktwxrkewwcmkrlbw.supabase.co/functions/v1/routine-push',
   headers := jsonb_build_object(
     'Content-Type','application/json',
     'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='routine_push_secret')
   ),
   body := '{}'::jsonb,
   timeout_milliseconds := 70000
 );
$job$);
