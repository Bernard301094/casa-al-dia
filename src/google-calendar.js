const scope='https://www.googleapis.com/auth/calendar.events.readonly';

export async function connectCalendar(auth,redirectTo) {
  const {data,error}=await auth.signInWithOAuth({
    provider:'google',options:{scopes:scope,redirectTo,skipBrowserRedirect:true,queryParams:{prompt:'consent'}},
  });
  if(error) throw error;
  location.assign(data.url);
}

export async function readGoogleEvents(token) {
  const now=new Date(), end=new Date(now);
  end.setDate(end.getDate()+90);
  const url=new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.search=new URLSearchParams({timeMin:now.toISOString(),timeMax:end.toISOString(),
    singleEvents:'true',orderBy:'startTime',maxResults:'250'});
  const response=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error('No se pudo leer Google Calendar. Revisa el permiso y la API de Calendar.');
  const {items,nextPageToken}=await response.json();
  return {more:Boolean(nextPageToken),events:items.filter(i=>i.summary&&(i.start?.date||i.start?.dateTime)).map(i=>{
    const local=new Date(i.start.dateTime);
    const pad=value=>String(value).padStart(2,'0');
    return {kind:'event',title:i.summary.slice(0,160),details:'',
      entry_date:i.start.date||[local.getFullYear(),pad(local.getMonth()+1),pad(local.getDate())].join('-'),
      entry_time:i.start.date?null:pad(local.getHours())+':'+pad(local.getMinutes())};
  })};
}
