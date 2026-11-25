import { createClient } from "npm:@supabase/supabase-js@2";
const escape = (text:string) => text.replace(/\\/g,"\\\\").replace(/\r?\n|\r/g,"\\n").replace(/[,;]/g,"\\$&");
function fold(line:string) {
  const encoder=new TextEncoder();
  let result="", length=0;
  for(const char of line) {
    const bytes=encoder.encode(char).length;
    if(length+bytes>75){result+="\r\n ";length=1;}
    result+=char;length+=bytes;
  }
  return result;
}
Deno.serve(async request=>{
  const token=new URL(request.url).searchParams.get("key");
  if(request.method!=="GET" || !token || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(token)) {
    return new Response(null,{status:404});
  }
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data,error}=await db.rpc("casa_read_calendar_feed",{code:token});
  if(error) return new Response(null,{status:503});
  if(!data) return new Response(null,{status:404});
  const lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Casa al Dia//Calendar//ES","CALSCALE:GREGORIAN",
    "X-WR-CALNAME:"+escape(data.name)];
  for(const event of data.events) {
    const day=event.entry_date.replace(/-/g,"");
    const time=event.entry_time?.slice(0,8).replace(/:/g,"");
    const stamp=new Date(event.created_at).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
    lines.push("BEGIN:VEVENT","UID:"+event.id+"@casa-al-dia","DTSTAMP:"+stamp,
      (time?"DTSTART:"+day+"T"+time:"DTSTART;VALUE=DATE:"+day),"SUMMARY:"+escape(event.title),"END:VEVENT");
  }
  lines.push("END:VCALENDAR","");
  return new Response(lines.map(fold).join("\r\n"),{headers:{
    "Content-Type":"text/calendar; charset=utf-8","Cache-Control":"private, no-store",
    "Referrer-Policy":"no-referrer","X-Robots-Tag":"noindex",
  }});
});
