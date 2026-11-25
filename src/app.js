import { createClient } from '@supabase/supabase-js';
import { url, key } from './config.js';
import { moduleDetails, fileKinds, nextBirthday, daysUntil, monthKey, memberLocation } from './family.js';

const db = createClient(url, key);
const app = document.querySelector('#app');
const editor = document.querySelector('#editor');
const modules = {
  today: ['Hoy','⌂'], event: ['Calendario','▦','evento'], task: ['Tareas','✓','tarea'],
  shopping: ['Compras','◫','producto'], meal: ['Comidas','♨','comida'], expense: ['Gastos','＄','gasto'],
  note: ['Notas','▤','nota'], message: ['Chat','◌','mensaje'], pet: ['Mascotas','♡','cuidado'],
  family: ['Mi familia','♧'], more: ['Explorar','⋯'],
  lists: ['Listas','☷'], activity: ['Actividad','◉'], location: ['Mapa','⌖'],
  ...moduleDetails,
};
const descriptions = {
  event:'Organiza los compromisos de la familia.', task:'Reparte los pendientes y marca lo que ya hicieron.',
  shopping:'Lleva la lista al mercado y actualízala en el momento.', meal:'Planifica qué van a comer durante la semana.',
  expense:'Registra los gastos compartidos en reales.', note:'Guarda información que todos necesiten consultar.',
  message:'Conversa con los miembros del hogar.', pet:'Lleva el registro de citas, vacunas y otros cuidados.',
};
const inviteStorage = 'casa-invite';
const initialInvite = new URL(location.href).searchParams.get('invitar');
if (initialInvite) {
  sessionStorage.setItem(inviteStorage, initialInvite);
  const clean = new URL(location.href);
  clean.searchParams.delete('invitar');
  history.replaceState(null, '', clean);
}
let session, household, subscription;
let homes = [], members = [], entries = [];
Object.entries(moduleDetails).forEach(([kind, labels]) => { descriptions[kind] = labels[3]; });
let currentInviteLink = '';
let activity = [];
let view = 'today', filter = '', status = 'all', mode = 'login', notice = '';
let busy = false, generation = 0, refreshVersion = 0;
const dateKey = (d = new Date()) => [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const fromKey = key => new Date(key + 'T12:00:00');
const dateLabel = (key, options = {day:'numeric', month:'long'}) => new Intl.DateTimeFormat('es',options).format(fromKey(key));
let pickedDay = dateKey(), calendarMonth = fromKey(pickedDay);
const money = value => new Intl.NumberFormat('es-BR',{style:'currency',currency:'BRL'}).format(value);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brand = '<div class="brand"><img src="icon.svg" alt=""> Casa al Día</div>';
const baseUrl = () => new URL(location.pathname,location.origin).href;
const opts = (list, selected) => list.map(([value,label]) => '<option value="'+escape(value)+'" '+(value===selected?'selected':'')+'>'+escape(label)+'</option>').join('');
const active = kind => entries.filter(item => item.kind === kind && !item.archived);
function show(text) {
  notice = text;
  const target = document.querySelector('#notice');
  if (target) target.textContent = text;
}
async function result(request) {
  const {data,error} = await request;
  if (error) throw error;
  return data;
}
function errorText(error) {
  const msg = error.message || '';
  if (/invalid login credentials/i.test(msg)) return 'Correo o contraseña inválidos.';
  if (/provider is not enabled|unsupported provider/i.test(msg)) return 'El acceso con Google está pendiente de configuración.';
  if (/email not confirmed/i.test(msg)) return 'Confirma tu correo antes de entrar.';
  if (/invalid or expired invitation|invalid input syntax for type uuid/i.test(msg)) return 'El código de invitación venció, ya se usó o no es válido.';
  if (/password/i.test(msg) && /characters|weak/i.test(msg)) return 'Usa una contraseña de al menos 8 caracteres.';
  return 'No se pudo completar la operación. ' + msg;
}
function authScreen() {
  const login = mode === 'login', forgot = mode === 'forgot', reset = mode === 'reset';
  const title = reset ? 'Nueva contraseña' : forgot ? 'Recupera tu cuenta' : login ? 'Entra a tu hogar' : 'Crea tu cuenta';
  app.innerHTML = '<div class="auth"><div class="auth-art">'+brand+'<h1>Organicen su hogar en un solo lugar.</h1><p>Calendario, compras y pendientes de la familia.</p></div><div class="auth-form"><section><h2>'+title+'</h2><p id="notice" class="notice" role="status">'+escape(notice)+'</p><form data-form="auth">'+
    (reset?'':'<label>Correo electrónico<input name="email" type="email" autocomplete="email" required></label>')+
    (forgot?'':'<label>Contraseña<input name="password" type="password" minlength="8" autocomplete="'+(login?'current-password':'new-password')+'" required></label>')+
    '<button class="primary">'+(reset?'Guardar contraseña':forgot?'Enviar enlace':login?'Entrar':'Registrarme')+'</button></form>'+
    (login||mode==='signup'?'<button type="button" data-act="google">Continuar con Google</button>':'')+
    (reset?'':login?'<button data-mode="signup">Crear cuenta</button><button data-mode="forgot">Olvidé mi contraseña</button>':'<button data-mode="login">Volver a iniciar sesión</button>')+
    '</section></div></div>';
}
function go(next) { view = next; filter = ''; status = 'all'; notice = ''; render(); window.scrollTo(0,0); }
function navigation(keys, css) {
  const current = css === 'bottom' && !keys.includes(view) ? 'more' : view;
  return '<nav class="'+css+'" aria-label="Navegación">'+keys.map(k =>
    '<button data-view="'+k+'" '+(current===k?'aria-current="page"':'')+'><span class="glyph" aria-hidden="true">'+modules[k][1]+'</span>'+modules[k][0]+'</button>').join('')+'</nav>';
}
function render() {
  if (!session || mode === 'reset') { authScreen(); return; }
  const homeBar = homes.length ? '<label>Hogar<select id="homes">'+opts(homes.map(h=>[h.id,h.name]),household?.id)+'</select></label>' : '';
  const add = descriptions[view] && household ? '<button class="primary" data-new="'+view+'">＋ '+(view==='message'?'Escribir':'Agregar')+'</button>' : '';
  const invite = sessionStorage.getItem(inviteStorage);
  const top = household ? modules[view][0] : 'Tu hogar';
  app.innerHTML = '<div class="shell"><aside class="side">'+brand+homeBar+
    (household?navigation(Object.keys(modules).filter(k=>k!=='more'),'nav'):'')+
    '<button data-act="logout">Cerrar sesión</button></aside><main class="content"><header class="top"><div><small>'+escape(household?.name ?? 'Casa al Día')+'</small><h1>'+top+'</h1></div>'+add+'</header>'+
    '<p id="notice" class="notice" role="status">'+escape(notice)+'</p>'+
    (invite && view!== 'family' && household?'<button data-view="family">Tienes una invitación pendiente</button>':'')+
    (!household || view==='family'?family():view==='today'?dashboard():view==='more'?more():view==='lists'?listHub():view==='activity'?activityPanel():view==='location'?locations():listing(view))+
    '</main>'+(household?navigation(['today','event','lists','message','more'],'bottom'):'')+'</div>';
}
function family() {
  const owner = members.some(m=>m.user_id===session.user.id && m.role==='owner');
  const invite = sessionStorage.getItem(inviteStorage) ?? '';
  return '<div class="mobile-homes">'+(homes.length?'<label>Cambiar de hogar<select id="mobile-homes">'+opts(homes.map(h=>[h.id,h.name]),household?.id)+'</select></label>':'')+'</div><div class="grid">'+(household?'<section class="panel"><h2>Miembros</h2>'+members.map(m=>'<div class="row"><div class="grow"><strong>'+escape(m.name)+'</strong><p class="muted">'+(m.role==='owner'?'Administrador':'Miembro')+'</p></div>'+(owner&&m.role==='member'?'<button class="danger" data-remove="'+m.user_id+'">Quitar</button>':'')+'</div>').join('')+
    (owner?'<button class="primary" data-act="invite">Generar invitación</button><div id="invite-link">'+inviteMarkup()+'</div>':'')+'</section>':'')+
    '<section class="panel"><h2>Crear hogar</h2><form data-form="house"><label>Nombre del hogar<input name="house_name" maxlength="80" required></label><label>Tu nombre<input name="member_name" maxlength="80" required></label><button class="primary">Crear</button></form></section>'+
    '<section class="panel"><h2>Unirse a un hogar</h2><form data-form="join"><label>Código de invitación<input name="code" required value="'+escape(invite)+'"></label><label>Tu nombre<input name="member_name" maxlength="80" required></label><button class="primary">Unirme</button></form></section>'+
    '</div><button data-act="logout">Cerrar sesión</button>';
}
function inviteMarkup() {
  if (!currentInviteLink) return '';
  return '<label>Enlace de un solo uso, válido por 7 días<input readonly value="'+escape(currentInviteLink)+'"></label><button type="button" data-act="copy">Copiar invitación</button>';
}
function dashboard() {
  const today = dateKey();
  const events = active('event').filter(i=>i.entry_date===today).sort(byDate);
  const tasks = active('task').filter(i=>!i.done && (!i.entry_date || i.entry_date<=today));
  const shop = active('shopping').filter(i=>!i.done);
  const meals = active('meal').filter(i=>i.entry_date===today).sort(byDate);
  const upcoming = active('event').filter(i=>i.entry_date>today).sort(byDate).slice(0,4);
  const card = (kind,title,count,items) => '<section class="card"><small>'+title+'</small><div class="number">'+count+'</div>'+items.slice(0,3).map(i=>'<div class="grow">'+escape(i.title)+'</div>').join('')+'<button data-view="'+kind+'">Ver '+modules[kind][0].toLowerCase()+'</button></section>';
  return '<section class="hero"><small>'+dateLabel(today,{weekday:'long',day:'numeric',month:'long'})+'</small><h2>Así va el día en '+escape(household.name)+'</h2><p>'+(events.length?'Tienes '+events.length+' compromiso'+(events.length===1?'':'s')+' en la agenda de hoy.':'La agenda de hoy está libre.')+'</p></section>'+
    '<div class="grid">'+card('event','Compromisos hoy',events.length,events)+card('task','Tareas por atender',tasks.length,tasks)+card('shopping','Compras pendientes',shop.length,shop)+'</div>'+
    '<section class="panel"><h2>Próximos compromisos</h2>'+(upcoming.length?upcoming.map(row).join(''):'<p class="muted">No hay compromisos próximos.</p>')+'</section>'+
    '<section class="panel"><h2>Menú de hoy</h2>'+(meals.length?meals.map(row).join(''):'<p class="muted">No hay comidas planificadas.</p>')+'</section>';
}
const exploreGroups = [
  ['Organización',['lists','event','schedule','birthday','contact','family']],
  ['En familia',['recipe','meal','message','photo','document','activity','location']],
  ['Hogar',['budget','expense','note','pet']],
];
function exploreTile(kind) {
  return '<button class="module-tile" data-view="'+kind+'"><span class="module-icon" aria-hidden="true">'+modules[kind][1]+'</span><strong>'+modules[kind][0]+'</strong></button>';
}
function more() {
  return exploreGroups.map(([label,kinds])=>'<section class="panel"><h2>'+label+'</h2><div class="module-grid">'+kinds.map(exploreTile).join('')+'</div></section>').join('');
}
function listHub() {
  return '<div class="grid">'+['task','shopping'].map(kind=>{
    const groups=active(kind).reduce((map,item)=>{
      const name=item.category||'General';
      map.set(name,[...(map.get(name)||[]),item]);
      return map;
    },new Map());
    return '<section class="panel"><h2>'+modules[kind][0]+'</h2>'+[...groups].map(([name,items])=>'<div class="row"><span class="grow">'+escape(name)+'</span><small>'+items.filter(i=>!i.done).length+' pendientes</small></div>').join('')+
      '<button data-view="'+kind+'">Abrir '+modules[kind][0].toLowerCase()+'</button><button data-new="'+kind+'" class="primary">Agregar '+modules[kind][2]+'</button></section>';
  }).join('')+'</div>';
}
function activityPanel() {
  const labels={created:'agregó',updated:'actualizó',completed:'completó',archived:'archivó'};
  return '<section class="panel"><h2>Últimos cambios</h2>'+(activity.length?activity.map(i=>{
    const author=members.find(m=>m.user_id===i.actor)?.name||'Un miembro';
    return '<div class="row"><div class="grow">'+escape(author)+' '+labels[i.action]+' un registro de '+escape(modules[i.kind]?.[0]?.toLowerCase()||'actividad')+'<br><small>'+escape(new Date(i.created_at).toLocaleString('es'))+'</small></div></div>';
  }).join(''):'<p class="muted">Todavía no hay cambios registrados.</p>')+'</section>';
}
function locations() {
  const latest=new Map();
  active('location').forEach(item=>{if (!latest.has(item.author)) latest.set(item.author,item);});
  return '<section class="panel"><p>Comparte tu ubicación actual con este hogar cuando tú decidas. Cada ubicación queda visible durante un máximo de 24 horas.</p><button class="primary" data-act="shareLocation">Compartir mi ubicación</button><div>'+
    [...latest.values()].filter(i=>Date.now()-Date.parse(i.created_at)<86400000).map(i=>{
      const name=members.find(m=>m.user_id===i.author)?.name||'Miembro';
      const url='https://www.openstreetmap.org/?mlat='+i.latitude+'&mlon='+i.longitude+'#map=16/'+i.latitude+'/'+i.longitude;
      return '<div class="row"><div class="grow"><strong>'+escape(name)+'</strong><p class="muted">'+escape(new Date(i.created_at).toLocaleString('es'))+'</p><a href="'+escape(url)+'" target="_blank" rel="noopener noreferrer">Abrir en OpenStreetMap</a></div>'+
        (i.author===session.user.id?'<button class="danger" data-act="removeLocation">Quitar</button>':'')+'</div>';
    }).join('')+'</div></section>';
}
function budgetSummary() {
  const month=monthKey(dateKey());
  const spent=active('expense').filter(i=>monthKey(i.entry_date)===month).reduce((sum,i)=>sum+Number(i.amount),0);
  const budget=active('budget').filter(i=>monthKey(i.entry_date)===month).reduce((sum,i)=>sum+Number(i.amount),0);
  return '<section class="hero"><small>'+dateLabel(dateKey(),{month:'long',year:'numeric'})+'</small><h2>'+money(spent)+' gastados</h2><p>'+money(budget)+' de presupuesto · '+money(budget-spent)+' disponibles</p><button data-view="expense">Ver gastos</button></section>';
}
function byDate(a,b) { return ((a.entry_date??'9999')+(a.entry_time??'')).localeCompare((b.entry_date??'9999')+(b.entry_time??'')); }
function calendar() {
  const first = new Date(calendarMonth.getFullYear(),calendarMonth.getMonth(),1,12);
  const start = new Date(first);
  start.setDate(1 - (first.getDay()+6)%7);
  const counts = new Map();
  active('event').forEach(i=>counts.set(i.entry_date,(counts.get(i.entry_date)??0)+1));
  return '<section class="panel"><div class="top"><h2>'+dateLabel(dateKey(first),{month:'long',year:'numeric'})+'</h2><div class="actions"><button data-month="-1" aria-label="Mes anterior">‹</button><button data-month="1" aria-label="Mes siguiente">›</button><button data-act="calendarToday">Hoy</button></div></div>'+
    '<div class="calendar">'+['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d=>'<span class="day-label">'+d+'</span>').join('')+
    Array.from({length:42},(_,i)=>{const day = new Date(start);day.setDate(start.getDate()+i);const key=dateKey(day), count=counts.get(key)??0;
      return '<button class="'+(day.getMonth()===first.getMonth()?'':'outside ') + (key===pickedDay?'selected':'')+'" data-day="'+key+'" aria-pressed="'+(key===pickedDay)+'" aria-label="'+dateLabel(key)+', '+count+' eventos">'+day.getDate()+(count?'<small>'+count+' ev.</small>':'')+'</button>';}).join('')+'</div></section>';
}
function filtered(kind) {
  const q = filter.trim().toLocaleLowerCase('es');
  return active(kind).filter(i=>(view!=='event'||i.entry_date===pickedDay)&&(!q||[i.title,i.details,i.category].some(v=>v.toLocaleLowerCase('es').includes(q)))&&(status==='all'||i.done===(status==='done')));
}
function listing(kind) {
  const month = dateKey().slice(0,7);
  const total = active('expense').filter(i=>i.entry_date.startsWith(month)).reduce((sum,i)=>sum+Number(i.amount),0);
  return '<p class="muted">'+descriptions[kind]+'</p>'+
    (kind==='event'?calendar():kind==='budget'?budgetSummary():kind==='expense'?'<section class="hero"><small>Gastos registrados en '+dateLabel(dateKey(),{month:'long'})+'</small><h2>'+money(total)+'</h2></section>':'')+
    '<section class="panel"><div class="top"><h2>'+(kind==='event'?dateLabel(pickedDay,{weekday:'long',day:'numeric',month:'long'}):'Registros')+'</h2></div>'+
    '<div class="filters"><input id="search" type="search" aria-label="Buscar" placeholder="Buscar…" value="'+escape(filter)+'">'+
    (['task','shopping','pet'].includes(kind)?'<select id="status" aria-label="Estado">'+opts([['all','Todos'],['open','Pendientes'],['done','Completados']],status)+'</select>':'')+
    '</div><div id="results">'+results(kind)+'</div></section>';
}
function results(kind) {
  const data = filtered(kind);
  if(kind==='birthday') data.sort((a,b)=>nextBirthday(a.entry_date,dateKey()).localeCompare(nextBirthday(b.entry_date,dateKey())));
  if(kind==='schedule') data.sort(byDate);
  if (['event','task','meal','pet'].includes(kind)) data.sort(byDate);
  if (kind==='message') data.reverse();
  return data.length ? data.map(row).join('') : '<p class="muted">No hay registros para mostrar.</p>';
}
function row(i) {
  const member = members.find(m=>m.user_id===(i.kind==='message'?i.author:i.assignee));
  const checkable = ['task','shopping','pet'].includes(i.kind);
  const canEdit = i.kind!=='message'||i.author===session.user.id||members.some(m=>m.user_id===session.user.id&&m.role==='owner');
  const birthday=i.kind==='birthday'?nextBirthday(i.entry_date,dateKey()):null;
  const tags = [birthday?'En '+daysUntil(birthday,dateKey())+' días':'',i.entry_date?dateLabel(i.entry_date):'',i.entry_time?.slice(0,5),i.category,member?.name,i.amount!==null?money(i.amount):''].filter(Boolean);
  return '<article class="row '+(i.done?'checked ':'')+(i.kind==='message'?'message':'')+'">'+
    (checkable?'<input type="checkbox" data-check="'+i.id+'" aria-label="Completar '+escape(i.title)+'" '+(i.done?'checked':'')+'>':'')+
    '<div class="grow"><div class="title"><strong>'+escape(i.title)+'</strong></div><div class="meta">'+tags.map(t=>'<span class="pill">'+escape(t)+'</span>').join('')+'</div>'+
    (i.details?'<p class="detail">'+escape(i.details)+'</p>':'')+(i.attachment_path?'<button data-file="'+i.id+'">'+(i.kind==='photo'?'Ver archivo':'Descargar')+'</button>':'')+'</div>'+
    (canEdit?'<div class="actions"><button data-edit="'+i.id+'" aria-label="Editar '+escape(i.title)+'">Editar</button></div>':'')+'</article>';
}
function openEditor(kind, entry) {
  const hasDate = ['event','task','meal','expense','pet','birthday','schedule','budget'].includes(kind);
  const required = ['event','meal','expense','birthday','schedule','budget'].includes(kind);
  const assignee = ['event','task','pet','schedule'].includes(kind);
  const dateValue = entry ? entry.entry_date : kind==='event'?pickedDay:required?dateKey():'';
  const category = ({shopping:'Nombre de la lista',task:'Nombre de la lista',meal:'Momento del día',expense:'Categoría',budget:'Categoría',contact:'Teléfono',pet:'Mascota'})[kind];
  editor.innerHTML = '<h2>'+(entry?'Editar ':'Agregar ')+modules[kind][2]+'</h2><form data-form="entry" data-kind="'+kind+'" data-id="'+(entry?.id??'')+'">'+
    '<label>'+(kind==='message'?'Mensaje':kind==='shopping'?'Producto':'Título')+'<input name="title" maxlength="160" value="'+escape(entry?.title)+'" required></label>'+
    (category?'<label>'+category+'<input name="category" maxlength="80" value="'+escape(entry?.category)+'"></label>':'')+
    (hasDate?'<div class="split"><label>Fecha<input name="entry_date" type="date" value="'+escape(dateValue)+'" '+(required?'required':'')+'></label>'+
      (['expense','budget'].includes(kind)?'<label>Monto en R$<input name="amount" type="number" step="0.01" min="0" max="9999999999.99" value="'+escape(entry?.amount)+'" required></label>':'<label>Hora<input name="entry_time" type="time" value="'+escape(entry?.entry_time?.slice(0,5))+'"></label>')+'</div>':'')+
    (assignee?'<label>Responsable<select name="assignee">'+opts([['','Sin asignar'],...members.map(m=>[m.user_id,m.name])],entry?.assignee??'')+'</select></label>':'')+
    '<label>'+(({shopping:'Cantidad o detalles',recipe:'Ingredientes y preparación',contact:'Correo, dirección y notas'})[kind]||'Detalles')+'<textarea name="details" maxlength="4000" rows="3">'+escape(entry?.details)+'</textarea></label>'+
    (fileKinds[kind]&&!entry?'<label>Selecciona un archivo de hasta 20 MB<input type="file" name="attachment" accept="'+fileKinds[kind].accept+'" required></label>':'')+
    '<p id="form-error" role="alert" class="notice"></p><div class="actions"><button class="primary">'+(kind==='message'&&!entry?'Enviar':'Guardar')+'</button><button type="button" data-act="close">Cancelar</button>'+
    (entry?'<button type="button" class="danger" data-archive="'+entry.id+'">Archivar</button>':'')+'</div></form>';
  editor.showModal();
}
async function refresh() {
  if (!household) return;
  const id=household.id, version=++refreshVersion;
  const entryRequest = async () => {
    const all = [];
    for (let offset=0;;offset+=500) {
      const batch = await result(db.from('casa_entries').select('*').eq('household_id',id).eq('archived',false)
        .order('created_at',{ascending:false}).order('id').range(offset,offset+499));
      all.push(...batch);
      if (batch.length<500) return all;
    }
  };
  const [items, people, changes] = await Promise.all([
    entryRequest(),result(db.from('casa_members').select('*').eq('household_id',id).order('name')),
    result(db.from('casa_activity').select('*').eq('household_id',id).order('created_at',{ascending:false}).limit(75)),
  ]);
  if (household?.id!==id||version!==refreshVersion) return;
  if (!people.some(m=>m.user_id===session?.user.id)) { await loadHomes(); return; }
  entries=items; members=people; activity=changes;
  const focused=document.activeElement;
  if (focused?.id==='search' && document.querySelector('#results')) document.querySelector('#results').innerHTML=results(view);
  else if (!editor.open && !busy && !app.querySelector('form:focus-within')) render();
}
async function loadHomes(preferred) {
  const ticket=++generation;
  const data=await result(db.from('casa_households').select('id,name').order('name'));
  if(ticket!==generation||!session) return;
  homes=data;
  const saved=localStorage.getItem('casa-home-'+session.user.id);
  await selectHouse(homes.find(h=>h.id===(preferred??saved))??homes[0]);
}
async function selectHouse(next) {
  const previous=subscription;
  subscription=undefined;
  household=next; currentInviteLink=''; entries=[]; members=[]; notice='';
  if (previous) await db.removeChannel(previous);
  if (!next || household?.id!==next.id || !session) { render(); return; }
  localStorage.setItem('casa-home-'+session.user.id,next.id);
  await refresh();
  if (household?.id!==next.id || !members.length) return;
  const config = table=>({event:'*',schema:'public',table,filter:'household_id=eq.'+next.id});
  subscription=db.channel('casa-'+next.id)
    .on('postgres_changes',config('casa_entries'),()=>refresh().catch(e=>show(errorText(e))))
    .on('postgres_changes',config('casa_members'),()=>refresh().catch(e=>show(errorText(e))))
    .subscribe(state=>{if(state==='SUBSCRIBED') refresh().catch(e=>show(errorText(e)));});
}
async function handleSession(next) {
  const changed=session?.user.id!==next?.user.id;
  session=next;
  if (mode==='reset') {render(); return;}
  if (changed && next) {view='today'; await loadHomes();}
  if (!next) {
    ++generation; household=undefined; entries=[]; members=[]; homes=[];
    if(subscription) {const old=subscription; subscription=undefined; await db.removeChannel(old);}
  }
  render();
}
async function submit(form) {
  const values=Object.fromEntries(new FormData(form));
  const type=form.dataset.form;
  if (type==='auth') {
    const {email,password}=values;
    if (mode==='login') {
      const data=await result(db.auth.signInWithPassword({email,password})); notice=''; await handleSession(data.session);
    } else if (mode==='signup') {
      const data=await result(db.auth.signUp({email,password,options:{emailRedirectTo:baseUrl()}}));
      mode='login'; notice=data.session?'':'Revisa tu correo para confirmar la cuenta.'; await handleSession(data.session);
    } else if (mode==='forgot') {
      await result(db.auth.resetPasswordForEmail(email,{redirectTo:baseUrl()}));
      mode='login'; notice='Si el correo está registrado, recibirás un enlace de recuperación.'; render();
    } else {
      await result(db.auth.updateUser({password})); mode='login'; notice='Contraseña actualizada.'; await loadHomes(); render();
    }
    return;
  }
  if (type==='house'||type==='join') {
    const id=await result(db.rpc(type==='house'?'casa_create_household':'casa_join_household',values));
    if (type==='join') sessionStorage.removeItem(inviteStorage);
    await loadHomes(id); go('today'); return;
  }
  const payload={
    title:values.title.trim(), details:values.details.trim(), category:values.category?.trim()??'',
    entry_date:values.entry_date||null, entry_time:values.entry_time||null, amount:values.amount||null, assignee:values.assignee||null,
  };
  const id = form.dataset.id;
  if (id) await result(db.from('casa_entries').update(payload).eq('id',id).eq('household_id',household.id).select('id').single());
  else {
    const kind=form.dataset.kind;
    const file=form.querySelector('input[type=file]')?.files[0];
    let stored;
    if (file) {
      if (file.size>20971520) throw new Error('El archivo supera el límite de 20 MB.');
      const extension=file.name.split('.').at(-1).replace(/[^a-z0-9]/gi,'').slice(0,10);
      const path=household.id+'/'+session.user.id+'/'+crypto.randomUUID()+(extension?'.'+extension:'');
      stored=db.storage.from(fileKinds[kind].bucket);
      await result(stored.upload(path,file));
      Object.assign(payload,{attachment_path:path,attachment_name:file.name});
    }
    try {
      await result(db.from('casa_entries').insert({...payload,household_id:household.id,kind}).select('id').single());
    } catch(error) {
      if(stored) await stored.remove([payload.attachment_path]);
      throw error;
    }
  }
  if (form.dataset.kind==='event' && payload.entry_date) {
    pickedDay=payload.entry_date; calendarMonth=fromKey(pickedDay);
  }
  editor.close(); await refresh(); render(); show('Guardado.');
}
function showError(error) {
  const target=editor.open&&editor.querySelector('#form-error');
  if (target) target.textContent=errorText(error); else show(errorText(error));
}
async function run(button, fn) {
  if (busy) return;
  busy=true;
  if (button) button.disabled=true;
  try { await fn(); } catch(error) { showError(error); }
  finally { busy=false; if(button) button.disabled=false; }
}
document.addEventListener('submit',event=>{
  const form=event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  void run(event.submitter,()=>submit(form));
});
document.addEventListener('input',event=>{
  if(event.target.id==='search') {filter=event.target.value; document.querySelector('#results').innerHTML=results(view);}
});
document.addEventListener('change',event=>{
  const el=event.target;
  if(el.id==='status') {status=el.value; document.querySelector('#results').innerHTML=results(view);}
  if(el.id==='homes'||el.id==='mobile-homes') void run(el,async()=>{await selectHouse(homes.find(h=>h.id===el.value));go('today');});
  if(el.dataset.check) {
    const checked=el.checked;
    void run(el,async()=>{
      try {await result(db.from('casa_entries').update({done:checked}).eq('id',el.dataset.check).eq('household_id',household.id).select('id').single());}
      catch(error) {el.checked=!checked; throw error;}
      await refresh(); render();
    });
  }
});
document.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(!button || busy) return;
  const d=button.dataset;
  if(d.view) go(d.view);
  if(d.mode) {mode=d.mode; notice=''; render();}
  if(d.new) openEditor(d.new);
  if(d.edit) {const entry=entries.find(i=>i.id===d.edit);if(entry) openEditor(entry.kind,entry);}
  if(d.day) {pickedDay=d.day; calendarMonth=fromKey(pickedDay);render();}
  if(d.month) {calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+Number(d.month),1,12);pickedDay=dateKey(calendarMonth);render();}
  if(d.act==='calendarToday') {pickedDay=dateKey();calendarMonth=fromKey(pickedDay);render();}
  if(d.act==='close') editor.close();
  if(d.act==='google') void run(button,()=>result(db.auth.signInWithOAuth({provider:'google',options:{redirectTo:baseUrl()}})));
  if(d.file) void run(button,async()=>{
    const item=entries.find(i=>i.id===d.file);
    if (!item) return;
    const params=item.kind==='document'?{download:item.attachment_name}:{};
    const {signedUrl}=await result(db.storage.from(fileKinds[item.kind].bucket).createSignedUrl(item.attachment_path,60,params));
    const link=document.createElement('a');
    link.href=signedUrl; link.target='_blank'; link.rel='noopener noreferrer'; link.click();
  });
  if(d.act==='shareLocation' && confirm('¿Compartir tu ubicación actual con los miembros de este hogar?')) void run(button,async()=>{
    const coordinates=await memberLocation();
    await result(db.from('casa_entries').insert({household_id:household.id,kind:'location',title:'Ubicación compartida',...coordinates}));
    await refresh();render();
  });
  if(d.act==='removeLocation') void run(button,async()=>{
    await result(db.rpc('casa_withdraw_location',{h:household.id}));
    await refresh();render();
  });
  if(d.act==='logout') void run(button,async()=>{await result(db.auth.signOut());mode='login';notice='';await handleSession(null);});
  if(d.act==='invite') void run(button,async()=>{
    const code=await result(db.rpc('casa_create_invite',{h:household.id}));
    const link=new URL(baseUrl());link.searchParams.set('invitar',code);
    currentInviteLink=link.href; document.querySelector('#invite-link').innerHTML=inviteMarkup();
  });
  if(d.act==='copy') void run(button,async()=>{await navigator.clipboard.writeText(document.querySelector('#invite-link input').value);show('Enlace copiado.');});
  if(d.remove&&confirm('¿Quitar a este miembro del hogar?')) void run(button,async()=>{await result(db.rpc('casa_remove_member',{h:household.id,member_id:d.remove}));await refresh();render();});
  if(d.archive&&confirm('¿Archivar este registro?')) void run(button,async()=>{
    await result(db.from('casa_entries').update({archived:true}).eq('id',d.archive).eq('household_id',household.id).select('id').single());editor.close();await refresh();render();
  });
});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&household) refresh().catch(showError);});
app.textContent='Cargando Casa al Día…';
db.auth.onAuthStateChange((event,current)=>{
  if (event==='PASSWORD_RECOVERY') mode='reset';
  if (['INITIAL_SESSION','PASSWORD_RECOVERY','SIGNED_OUT','SIGNED_IN'].includes(event)) {
    setTimeout(()=>{if(event==='SIGNED_IN'&&session?.user.id===current?.user.id)return;handleSession(current).catch(error=>{render();showError(error);});},0);
  }
});

if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('sw.js').catch(console.error);
