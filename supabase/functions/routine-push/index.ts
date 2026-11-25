import { createClient } from "npm:@supabase/supabase-js@2";

type ServiceAccount = { project_id: string; client_email: string; private_key: string };
const encoder = new TextEncoder();
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const segment = (data: object) => encode(encoder.encode(JSON.stringify(data)));

async function authorize(account: ServiceAccount) {
  const pem = account.private_key.replace(/-----[^-]+-----|\s/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), c => c.charCodeAt(0)),
    { name:"RSASSA-PKCS1-v1_5", hash:"SHA-256" }, false, ["sign"]);
  const iat = Math.floor(Date.now()/1000);
  const endpoint = "https://oauth2.googleapis.com/token";
  const body = segment({alg:"RS256",typ:"JWT"})+"."+segment({
    iss:account.client_email,scope:"https://www.googleapis.com/auth/firebase.messaging",aud:endpoint,iat,exp:iat+3600,
  });
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,encoder.encode(body));
  const response = await fetch(endpoint,{method:"POST", body:new URLSearchParams({
    grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer", assertion:body+"."+encode(new Uint8Array(signature)),
  }),signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error("FCM authentication failed");
  return (await response.json()).access_token as string;
}

Deno.serve(async request => {
  const candidate = request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (request.method!=="POST" || !candidate) return new Response(null,{status:403});
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth:{persistSession:false,autoRefreshToken:false},
    });
    const authorization=await db.rpc("casa_verify_push_invocation",{candidate});
    if (authorization.error) throw authorization.error;
    if (!authorization.data) return new Response(null,{status:403});
    const account = JSON.parse(Deno.env.get("FCM_SERVICE_ACCOUNT_JSON") || "null") as ServiceAccount | null;
    if (!account) return Response.json({error:"FCM is awaiting configuration"},{status:503});
    if (account.project_id!=="casa-al-dia-243df") return Response.json({error:"Unexpected Firebase project"},{status:422});
    const access = await authorize(account);
    if (request.headers.get("x-casa-probe")==="1") {
      const response=await fetch("https://fcm.googleapis.com/v1/projects/"+account.project_id+"/messages:send",{
        method:"POST",headers:{Authorization:"Bearer "+access,"Content-Type":"application/json"},
        body:JSON.stringify({validate_only:true,message:{topic:"casa-validation",notification:{title:"Casa al Día"}}}),
        signal:AbortSignal.timeout(10000),
      });
      return Response.json({validated:response.ok,provider_status:response.status},{status:response.ok?200:502});
    }
    const {data: jobs,error} = await db.rpc("casa_claim_routine_push");
    if (error) throw error;
    let sent=0, failed=0;
    for (let offset=0; offset<jobs.length; offset+=10) {
      await Promise.all(jobs.slice(offset,offset+10).map(async (job:{token:string;routine_id:string;day:string})=>{
        try {
          const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,{
            method:"POST",headers:{Authorization:"Bearer "+access,"Content-Type":"application/json"},
            body:JSON.stringify({message:{
              token:job.token,
              webpush:{headers:{TTL:"300"},notification:{title:"Casa al Día",body:"Rutinas · Rotinas",
                tag:job.routine_id+"-"+job.day},fcm_options:{link:"https://casa-al-dia-familiar.bernard30101994.chatgpt.site/"}},
            }}),signal:AbortSignal.timeout(10000),
          });
          if (response.ok) {
            const {error} = await db.from("casa_push_deliveries").update({sent_at:new Date().toISOString()})
              .eq("token",job.token).eq("routine_id",job.routine_id).eq("day",job.day);
            if (error) throw error;
            sent++;
          } else {
            const payload = await response.json().catch(()=>null);
            if (payload?.error?.details?.some((detail:{errorCode?:string})=>detail.errorCode==="UNREGISTERED")) {
              await db.from("casa_push_devices").delete().eq("token",job.token);
            }
            failed++;
          }
        } catch {
          failed++;
        }
      }));
    }
    return Response.json({sent,failed});
  } catch {
    return Response.json({error:"Routine push processing failed"},{status:502});
  }
});
