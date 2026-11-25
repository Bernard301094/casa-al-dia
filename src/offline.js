import Dexie from 'dexie';

const cache = new Dexie('casa-local-v1');
cache.version(1).stores({
  snapshots:'[user+home]',
  outbox:'++sequence,user,[user+home]',
  drafts:'[user+scope]',
  files:'[user+home+path]',
});
const householdsKey='households';
const changes = (user,home) => cache.outbox.where('[user+home]').equals([user,home]);
export const getHomes = async user => (await cache.snapshots.get([user,householdsKey]))?.data;
export const putHomes = (user,data) => cache.snapshots.put({user,home:householdsKey,data});
export const getDraft = (user,scope) => cache.drafts.get([user,scope]);
export const putDraft = (user,scope,values,checks) => cache.drafts.put({user,scope,values,checks});
export const clearDraft = (user,scope) => cache.drafts.delete([user,scope]);
export const localFile = async (user,home,path) => (await cache.files.get([user,home,path]))?.blob;
export const putFile = (user,home,path,blob) => cache.files.put({user,home,path,blob});
export const queueStatus = async user => {
  const queued=await cache.outbox.where('user').equals(user).toArray();
  return {count:queued.length,failed:queued.some(change=>change.failed)};
};

const collections={
  casa_entries:'entries',casa_boards:'boards',casa_board_cards:'cards',
  casa_list_templates:'lists',casa_routines:'routines',casa_routine_days:'days',
};
function entryDefaults(change) {
  return {created_at:change.created,author:change.user,title:'',details:'',category:'',
    entry_date:null,entry_time:null,amount:null,assignee:null,done:false,archived:false};
}
export function applyChange(snapshot,change) {
  const {entity,action,recordId,payload,home}=change;
  if (action==='createHouse') return snapshot;
  if (action==='withdrawLocation') {
    return {...snapshot,entries:snapshot.entries.filter(row=>row.kind!=='location'||row.author!==change.user)};
  }
  const collection=collections[entity];
  const rows=snapshot[collection];
  if (action==='routineDay') {
    const item={...payload,household_id:home,routine_id:recordId};
    return {...snapshot,[collection]:[...rows.filter(row=>row.routine_id!==recordId||row.day!==item.day),item]};
  }
  if (action==='batch') {
    const items=payload.items.filter(item=>!rows.some(row=>row.id===item.id)).map(item=>({
      ...entryDefaults(change),...item,household_id:home,kind:payload.kind,category:payload.category,
    }));
    return {...snapshot,[collection]:[...items,...rows]};
  }
  if (action==='insert') {
    if (rows.some(row=>row.id===recordId)) return snapshot;
    const defaults=entity==='casa_entries'?entryDefaults(change):{archived:false,created_at:change.created};
    return {...snapshot,[collection]:[{...defaults,...payload,id:recordId,household_id:home},...rows]};
  }
  return {...snapshot,[collection]:payload.archived?rows.filter(row=>row.id!==recordId):
    rows.map(row=>row.id===recordId?{...row,...payload}:row)};
}

const emptySnapshot=()=>({entries:[],members:[],activity:[],routines:[],days:[],boards:[],cards:[],lists:[]});
export async function readHome(user,home) {
  return cache.transaction('r',cache.snapshots,cache.outbox,async()=>{
    const base=(await cache.snapshots.get([user,home]))?.data??emptySnapshot();
    return (await changes(user,home).sortBy('sequence')).reduce(applyChange,base);
  });
}
export async function putHome(user,home,data) {
  await cache.snapshots.put({user,home,data});
}
export async function enqueue(change) {
  await enqueueMany([change],change.scope);
}
export async function enqueueMany(records,scope) {
  await cache.transaction('rw',cache.outbox,cache.drafts,cache.files,async()=>{
    for (const {scope:ignored,...change} of records) {
      await cache.outbox.add({...change,identity:crypto.randomUUID(),created:new Date().toISOString()});
      if (change.file) await putFile(change.user,change.home,change.file.path,change.file.blob);
    }
    if (scope && records.length) await clearDraft(records[0].user,scope);
  });
}
export async function createLocalHome(user,houseName,memberName) {
  const id=crypto.randomUUID();
  const home={id,name:houseName};
  await cache.transaction('rw',cache.snapshots,cache.outbox,async()=>{
    await putHomes(user,[...await getHomes(user)??[],home]);
    await putHome(user,id,{...emptySnapshot(),members:[{household_id:id,user_id:user,name:memberName,role:'owner'}]});
    await cache.outbox.add({identity:id,user,home:id,entity:'casa_households',action:'createHouse',
      recordId:id,payload:{house_name:houseName,member_name:memberName},created:new Date().toISOString()});
  });
  return home;
}

export async function keepLocalHomes(user,remote) {
  return cache.transaction('rw',cache.snapshots,cache.outbox,async()=>{
    const pending=await cache.outbox.where('user').equals(user).filter(change=>change.action==='createHouse').toArray();
    const known=new Set(remote.map(home=>home.id));
    const combined=[...remote,...pending.filter(change=>!known.has(change.home)).map(change=>({
      id:change.home,name:change.payload.house_name,
    }))];
    await putHomes(user,combined);
    return combined;
  });
}
export async function replay(user,cloud) {
  const execute=async()=>{
    const updated=new Set(), blocked=new Set();
    const pending=await cache.outbox.where('user').equals(user).sortBy('sequence');
    for (const change of pending) {
      if (blocked.has(change.home)) continue;
      try {
        if (change.file) {
          const {bucket,path,blob}=change.file;
          const {error}=await cloud.storage.from(bucket).upload(path,blob,{contentType:blob.type});
          if (error) {
            const {data:exists}=await cloud.storage.from(bucket).exists(path);
            if (!exists) throw error;
          }
        }
        const {error}=await (change.action==='createHouse' ?
          cloud.rpc('casa_create_household_queued',{owner_id:user,h:change.home,...change.payload}) :
          cloud.rpc('casa_replay_change',{
            owner_id:user,change_id:change.identity,h:change.home,action:change.action,entity:change.entity,
            record_id:change.recordId,payload:change.payload,
          }));
        if (error) throw error;
        await cache.transaction('rw',cache.snapshots,cache.outbox,async()=>{
          const previous=(await cache.snapshots.get([user,change.home]))?.data??emptySnapshot();
          await cache.snapshots.put({user,home:change.home,data:applyChange(previous,change)});
          await cache.outbox.delete(change.sequence);
        });
        updated.add(change.home);
      } catch(error) {
        blocked.add(change.home);
        const code=String(error.code??error.statusCode??'');
        if (/^(22|23|42|P0001|PGRST116|4\d\d$)/.test(code) && !['401','408','429'].includes(code)) {
          await cache.outbox.update(change.sequence,{failed:true});
        }
      }
    }
    return updated;
  };
  return navigator.locks ? navigator.locks.request('casa-sync-'+user,execute) : execute();
}
