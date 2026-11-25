import { occurrence, routinePanel, routineEditor } from './routines.js';
import { t, locale, setLocale, languageControl, plural } from './i18n.js';
import '@fontsource-variable/dm-sans/wght.css';
import '@fontsource-variable/outfit/wght.css';
import { icon, animateEntry, currentTheme, toggleTheme } from './presentation.js';
import { createClient } from '@supabase/supabase-js';
import { url, key } from './config.js';
import { moduleDetails, fileKinds, nextBirthday, daysUntil, monthKey, memberLocation } from './family.js';

const db = createClient(url, key);
const app = document.querySelector('#app');
const editor = document.querySelector('#editor');
let modules, descriptions;
function localizeModules() {
  const extras = moduleDetails();
  modules = {
    today: [t('Hoy'),'⌂'], event: [t('Calendario'),'▦',t('evento')], task: [t('Tareas'),'✓',t('tarea')],
    shopping: [t('Compras'),'◫',t('producto')], meal: [t('Comidas'),'♨',t('comida')], expense: [t('Gastos'),'＄',t('gasto')],
    note: [t('Notas'),'▤',t('nota')], message: [t('Chat'),'◌',t('mensaje')], pet: [t('Mascotas'),'♡',t('cuidado')],
    family: [t('Mi familia'),'♧'], more: [t('Explorar'),'⋯'],
    routine: [t('Rutinas'),'↻'], lists: [t('Listas'),'☷'], activity: [t('Actividad'),'◉'], location: [t('Mapa'),'⌖'],
    ...extras,
  };
  descriptions = {
    event:t('Organiza los compromisos de la familia.'), task:t('Reparte los pendientes y marca lo que ya hicieron.'),
    shopping:t('Lleva la lista al mercado y actualízala en el momento.'), meal:t('Planifica qué van a comer durante la semana.'),
    expense:t('Registra los gastos compartidos en reales.'), note:t('Guarda información que todos necesiten consultar.'),
    message:t('Conversa con los miembros del hogar.'), pet:t('Lleva el registro de citas, vacunas y otros cuidados.'),
  };
  Object.entries(extras).forEach(([kind, labels]) => { descriptions[kind] = labels[3]; });
}
localizeModules();
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
let currentInviteLink = '';
let activity = [];
let routines = [], routineDays = [];
let view = 'today', filter = '', status = 'all', mode = 'login', notice = '';
let busy = false, generation = 0, refreshVersion = 0;
const dateKey = (d = new Date()) => [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const fromKey = key => new Date(key + 'T12:00:00');
const dateLabel = (key, options = {day:'numeric', month:'long'}) => new Intl.DateTimeFormat(locale(),options).format(fromKey(key));
const tomorrowKey = (now = new Date()) => {
  const tomorrow=new Date(now);
  tomorrow.setDate(tomorrow.getDate()+1);
  return dateKey(tomorrow);
};
let routineDate = dateKey();
let pickedDay = dateKey(), calendarMonth = fromKey(pickedDay);
const money = value => new Intl.NumberFormat(locale(),{style:'currency',currency:'BRL'}).format(value);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brand = '<div class="brand"><img src="icon.svg" alt=""> <span>Casa al Día</span></div>';
function themeControl() {
  const dark=currentTheme()==='dark';
  return '<button type="button" class="icon-button" data-act="theme" aria-label="'+(dark?t('Usar tema claro'):t('Usar tema oscuro'))+'">'+icon(dark?'sun':'moon')+'</button>';
}
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
  if (/invalid login credentials/i.test(msg)) return t('Correo o contraseña inválidos.');
  if (/provider is not enabled|unsupported provider/i.test(msg)) return t('El acceso con Google está pendiente de configuración.');
  if (/email not confirmed/i.test(msg)) return t('Confirma tu correo antes de entrar.');
  if (/invalid or expired invitation|invalid input syntax for type uuid/i.test(msg)) return t('El código de invitación venció, ya se usó o no es válido.');
  if (/password/i.test(msg) && /characters|weak/i.test(msg)) return t('Usa una contraseña de al menos 8 caracteres.');
  if (['Este navegador no admite ubicación.',
    'No pudimos obtener tu ubicación. Revisa el permiso del navegador.',
    'El archivo supera el límite de 20 MB.', 'Selecciona dos responsables distintos para alternar.',
    'Indica una hora para el recordatorio.'].includes(msg)) return t(msg);
  return t('No se pudo completar la operación.') + (locale()==='es-419' && msg ? ' '+msg : '');
}
function authScreen() {
  const login = mode === 'login', forgot = mode === 'forgot', reset = mode === 'reset';
  const title = reset ? t('Nueva contraseña') : forgot ? t('Recupera tu cuenta') : login ? t('Entra a tu hogar') : t('Crea tu cuenta');
  app.innerHTML = '<div class="auth"><div class="auth-art">'+brand+("<h1>"+t("Organicen su hogar en un solo lugar.")+"</h1><p>"+t("Calendario, compras y pendientes de la familia.")+"</p><div class=\"auth-modules\">")+['event','shopping','message'].map(kind=>'<span>'+icon(kind)+modules[kind][0]+'</span>').join('')+'</div></div><div class="auth-form"><section><div class="auth-title"><h2>'+title+'</h2>'+themeControl()+'</div>'+languageControl()+'<p id="notice" class="notice" role="status">'+escape(notice)+'</p><form data-form="auth">'+
    (reset?'':("<label>"+t("Correo electrónico")+"<input name=\"email\" type=\"email\" autocomplete=\"email\" required></label>"))+
    (forgot?'':'<label>'+t('Contraseña')+'<input name="password" type="password" minlength="8" autocomplete="'+(login?'current-password':'new-password')+'" required></label>')+
    '<button class="primary">'+(reset?t('Guardar contraseña'):forgot?t('Enviar enlace'):login?t('Entrar'):t('Registrarme'))+'</button></form>'+
    (login||mode==='signup'?("<button type=\"button\" data-act=\"google\">"+t("Continuar con Google")+"</button>"):'')+
    (reset?'':login?("<button data-mode=\"signup\">"+t("Crear cuenta")+"</button><button data-mode=\"forgot\">"+t("Olvidé mi contraseña")+"</button>"):("<button data-mode=\"login\">"+t("Volver a iniciar sesión")+"</button>"))+
    '</section></div></div>';
}
function go(next) { view = next; filter = ''; status = 'all'; notice = ''; render(); window.scrollTo(0,0); animateEntry(app.querySelector('main')); }
function navigation(keys, css) {
  const current = !keys.includes(view) ? 'more' : view;
  return '<nav class="'+css+'" aria-label="'+t('Navegación')+'">' +keys.map(k =>
    '<button data-view="'+k+'" '+(current===k?'aria-current="page"':'')+'>'+icon(k)+modules[k][0]+'</button>').join('')+'</nav>';
}
function render() {
  if (!session || mode === 'reset') { authScreen(); return; }
  const homeBar = homes.length ? ("<label>"+t("Hogar")+"<select id=\"homes\">")+opts(homes.map(h=>[h.id,h.name]),household?.id)+'</select></label>' : '';
  const add = descriptions[view] && household ? '<button class="primary" data-new="'+view+'">'+icon('plus')+(view==='message'?t('Escribir'):t('Agregar'))+'</button>' : '';
  const invite = sessionStorage.getItem(inviteStorage);
  const top = household ? modules[view][0] : t('Tu hogar');
  app.innerHTML = '<div class="shell"><aside class="side">'+brand+homeBar+
    (household?navigation(['today','event','lists','routine','shopping','meal','message','more','family'],'nav'):'')+
    '<button class="side-footer" data-act="logout">'+icon('signout')+(t("Cerrar sesión")+"</button></aside><main class=\"content\"><header class=\"page-head\"><div><div class=\"workspace-label\">")+escape(household?.name ?? 'Casa al Día')+'</div><h1>'+top+'</h1></div><div class="actions">'+add+themeControl()+'</div>'+languageControl()+'</header>'+
    '<p id="notice" class="notice" role="status">'+escape(notice)+'</p>'+
    (invite && view!== 'family' && household?("<button data-view=\"family\">"+t("Tienes una invitación pendiente")+"</button>"):'')+
    '<div id="routine-notice" class="notice" role="status">'+reminderText()+'</div>'+
    (!household || view==='family'?family():view==='today'?dashboard():view==='more'?more():view==='lists'?listHub():view==='activity'?activityPanel():view==='routine'?routinePanel({date:routineDate,routines,occurrences:routinesOn(routineDate),members,escape,options:opts}):view==='location'?locations():listing(view))+
    '</main>'+(household?navigation(['today','event','lists','message','more'],'bottom'):'')+'</div>';
}
function family() {
  const owner = members.some(m=>m.user_id===session.user.id && m.role==='owner');
  const invite = sessionStorage.getItem(inviteStorage) ?? '';
  return '<div class="mobile-homes">'+(homes.length?("<label>"+t("Cambiar de hogar")+"<select id=\"mobile-homes\">")+opts(homes.map(h=>[h.id,h.name]),household?.id)+'</select></label>':'')+'</div><div class="grid">'+(household?("<section class=\"panel\"><h2>"+t("Miembros")+"</h2>")+members.map(m=>'<div class="row"><div class="grow"><strong>'+escape(m.name)+'</strong><p class="muted">'+(m.role==='owner'?t('Administrador'):t('Miembro'))+'</p></div>'+(owner&&m.role==='member'?'<button class="danger" data-remove="'+m.user_id+'">' + t('Quitar') + '</button>':'')+'</div>').join('')+
    (owner?("<button class=\"primary\" data-act=\"invite\">"+t("Generar invitación")+"</button><div id=\"invite-link\">")+inviteMarkup()+'</div>':'')+'</section>':'')+
    ("<section class=\"panel\"><h2>"+t("Crear hogar")+"</h2><form data-form=\"house\"><label>"+t("Nombre del hogar")+"<input name=\"house_name\" maxlength=\"80\" required></label><label>"+t("Tu nombre")+"<input name=\"member_name\" maxlength=\"80\" required></label><button class=\"primary\">"+t("Crear")+"</button></form></section>")+
    ("<section class=\"panel\"><h2>"+t("Unirse a un hogar")+"</h2><form data-form=\"join\"><label>"+t("Código de invitación")+"<input name=\"code\" required value=\"")+escape(invite)+("\"></label><label>"+t("Tu nombre")+"<input name=\"member_name\" maxlength=\"80\" required></label><button class=\"primary\">"+t("Unirme")+"</button></form></section>")+
    ("</div><button data-act=\"logout\">"+t("Cerrar sesión")+"</button>");
}
function inviteMarkup() {
  if (!currentInviteLink) return '';
  return '<label>'+t('Enlace de un solo uso, válido por 7 días')+'<input readonly value="'+escape(currentInviteLink)+("\"></label><button type=\"button\" data-act=\"copy\">"+t("Copiar invitación")+"</button>");
}
function routinesOn(date) {
  const exceptions=new Map(routineDays.filter(row=>row.day===date).map(row=>[row.routine_id,row]));
  return routines.map(item=>occurrence(item,date,exceptions.get(item.id))).filter(Boolean);
}
function reminderText() {
  if (!household || !session) return '';
  const now=new Date();
  const today=dateKey(now);
  const due=[...routinesOn(today),...routinesOn(tomorrowKey(now))].filter(item=>{
    if (item.status!=='pending' || item.reminder_minutes===null || !item.due_time) return false;
    const assigned=members.some(member=>member.user_id===item.assignee) && item.assignee;
    if (assigned && assigned!==session.user.id) return false;
    const scheduled=new Date(item.day+'T'+item.due_time.slice(0,5));
    return now.getTime()>=scheduled.getTime()-item.reminder_minutes*60000;
  });
  return due.length ? escape(t('Recordatorio de rutinas'))+': '+due.map(item=>escape(item.title)).join(' · ') : '';
}
function updateRoutineNotice() {
  const target=document.querySelector('#routine-notice');
  if (!target || document.visibilityState!=='visible') return;
  const message=reminderText();
  if (target.innerHTML!==message) target.innerHTML=message;
}
function dashboard() {
  const today = dateKey();
  const events = active('event').filter(i=>i.entry_date===today).sort(byDate);
  const tasks = active('task').filter(i=>!i.done && (!i.entry_date || i.entry_date<=today));
  const shop = active('shopping').filter(i=>!i.done);
  const meals = active('meal').filter(i=>i.entry_date===today).sort(byDate);
  const upcoming = active('event').filter(i=>i.entry_date>today).sort(byDate).slice(0,4);
  const card = (kind,title,count,items) => '<button class="summary-card tone-'+kind+'" data-view="'+kind+'"><span class="summary-top"><span class="module-icon">'+icon(kind)+'</span>'+icon('chevron','summary-chevron')+'</span><span class="summary-number">'+count+'</span><strong>'+title+'</strong>'+ (items.length ? '<small>'+escape(items[0].title)+'</small>' : '')+'</button>';
  return '<section class="hero dashboard-hero"><div class="hero-copy"><span class="hero-date">'+icon('calendar')+dateLabel(today,{weekday:'long',day:'numeric',month:'long'})+'</span><h2>'+t('Así va el día')+'<br>'+escape(t('en {home}',{home:household.name}))+'</h2><p>'+(events.length?plural(events.length,'Tienes {count} compromiso hoy.','Tienes {count} compromisos hoy.'):t('La agenda de hoy está libre.'))+'</p><button data-new="event" class="hero-button">'+icon('plus')+(t("Nuevo evento")+"</button></div><div class=\"hero-art\" aria-hidden=\"true\"><div class=\"hero-orb\"></div><div class=\"hero-deco hero-deco-calendar\">")+icon('event')+'</div><div class="hero-deco hero-deco-tasks">'+icon('task')+'</div><div class="hero-deco hero-deco-heart">'+icon('family')+'</div></div></section>'+
    '<div class="dashboard-stats">'+card('event',t('Compromisos hoy'),events.length,events)+card('task',t('Tareas pendientes'),tasks.length,tasks)+card('shopping',t('Compras pendientes'),shop.length,shop)+'</div>'+
    '<section class="panel"><div class="section-heading"><h2>'+t('Rutinas de hoy')+'</h2><button data-view="routine" class="text-button">'+t('Ver rutinas')+'</button></div>'+routineOverview(today)+'</section>'+
    ("<div class=\"dashboard-columns\"><section class=\"panel\"><div class=\"section-heading\"><h2>"+t("Próximos compromisos")+"</h2><button class=\"text-button\" data-view=\"event\">"+t("Calendario")+" ")+icon('chevron')+'</button></div>'+(upcoming.length?upcoming.map(row).join(''):emptyState('event',t('No hay compromisos próximos.'),t('Agregar evento')))+'</section>'+
    ("<section class=\"panel\"><div class=\"section-heading\"><h2>"+t("Menú de hoy")+"</h2><button class=\"text-button\" data-view=\"meal\">"+t("Comidas")+" ")+icon('chevron')+'</button></div>'+(meals.length?meals.map(row).join(''):emptyState('meal',t('No hay comidas planificadas.'),t('Planificar comida')))+'</section></div>';
}
function routineOverview(today) {
  const pending=routinesOn(today).filter(item=>item.status==='pending');
  return pending.length ? pending.map(item=>{
    const assignee=members.find(member=>member.user_id===item.assignee)?.name;
    return '<div class="row"><strong class="grow">'+escape(item.title)+'</strong><small>'+
      escape([item.due_time?.slice(0,5),assignee].filter(Boolean).join(' · '))+'</small></div>';
  }).join('') : '<p class="muted">'+t('No hay rutinas pendientes para hoy.')+'</p>';
}
function emptyState(kind,text,action) {
  return '<div class="empty-state"><span class="module-icon">'+icon(kind)+'</span><p>'+text+'</p>'+(action?'<button class="text-button" data-new="'+kind+'">'+icon('plus')+action+'</button>':'')+'</div>';
}

const exploreGroups = [
  ['Organización',['lists','event','routine','schedule','birthday','contact','family']],
  ['En familia',['recipe','meal','message','photo','document','activity','location']],
  ['Hogar',['budget','expense','note','pet']],
];
function exploreTile(kind) {
  return '<button class="module-tile tone-'+kind+'" data-view="'+kind+'"><span class="module-icon">'+icon(kind)+'</span><strong>'+modules[kind][0]+'</strong>'+icon('chevron','tile-chevron')+'</button>';
}
function more() {
  return exploreGroups.map(([label,kinds])=>'<section class="panel explore-section"><h2>'+t(label)+'</h2><div class="module-grid">'+kinds.map(exploreTile).join('')+'</div></section>').join('');
}
function listHub() {
  return '<div class="grid">'+['task','shopping'].map(kind=>{
    const groups=active(kind).reduce((map,item)=>{
      const name=item.category||t('General');
      map.set(name,[...(map.get(name)||[]),item]);
      return map;
    },new Map());
    return '<section class="panel"><h2>'+modules[kind][0]+'</h2>'+[...groups].map(([name,items])=>'<div class="row"><span class="grow">'+escape(name)+'</span><small>'+plural(items.filter(i=>!i.done).length,'{count} pendiente','{count} pendientes')+'</small></div>').join('')+
      '<button data-view="'+kind+'">'+t('Abrir ') +modules[kind][0].toLowerCase()+'</button><button data-new="'+kind+'" class="primary">'+t('Agregar ')+modules[kind][2]+'</button></section>';
  }).join('')+'</div>';
}
function activityPanel() {
  const labels={created:t('agregó'),updated:t('actualizó'),completed:t('completó'),archived:t('archivó')};
  return ("<section class=\"panel\"><h2>"+t("Últimos cambios")+"</h2>")+(activity.length?activity.map(i=>{
    const author=members.find(m=>m.user_id===i.actor)?.name||t('Un miembro');
    return '<div class="row"><div class="grow">'+escape(author)+' '+labels[i.action]+t(' un registro de ')+escape(modules[i.kind]?.[0]?.toLowerCase()||t('actividad'))+'<br><small>'+escape(new Date(i.created_at).toLocaleString(locale()))+'</small></div></div>';
  }).join(''):("<p class=\"muted\">"+t("Todavía no hay cambios registrados.")+"</p>"))+'</section>';
}
function locations() {
  const latest=new Map();
  active('location').forEach(item=>{if (!latest.has(item.author)) latest.set(item.author,item);});
  return ("<section class=\"panel\"><p>"+t("Comparte tu ubicación actual con este hogar cuando tú decidas. Cada ubicación queda visible durante un máximo de 24 horas.")+"</p><button class=\"primary\" data-act=\"shareLocation\">"+t("Compartir mi ubicación")+"</button><div>")+
    [...latest.values()].filter(i=>Date.now()-Date.parse(i.created_at)<86400000).map(i=>{
      const name=members.find(m=>m.user_id===i.author)?.name||t('Miembro');
      const url='https://www.openstreetmap.org/?mlat='+i.latitude+'&mlon='+i.longitude+'#map=16/'+i.latitude+'/'+i.longitude;
      return '<div class="row"><div class="grow"><strong>'+escape(name)+'</strong><p class="muted">'+escape(new Date(i.created_at).toLocaleString(locale()))+'</p><a href="'+escape(url)+'" target="_blank" rel="noopener noreferrer">'+t('Abrir en OpenStreetMap')+'</a></div>'+
        (i.author===session.user.id?("<button class=\"danger\" data-act=\"removeLocation\">"+t("Quitar")+"</button>"):'')+'</div>';
    }).join('')+'</div></section>';
}
function budgetSummary() {
  const month=monthKey(dateKey());
  const spent=active('expense').filter(i=>monthKey(i.entry_date)===month).reduce((sum,i)=>sum+Number(i.amount),0);
  const budget=active('budget').filter(i=>monthKey(i.entry_date)===month).reduce((sum,i)=>sum+Number(i.amount),0);
  return '<section class="hero"><small>'+dateLabel(dateKey(),{month:'long',year:'numeric'})+'</small><h2>'+money(spent)+(t(" gastados")+"</h2><p>")+money(budget)+t(' de presupuesto · ')+money(budget-spent)+(t(" disponibles")+"</p><button data-view=\"expense\">"+t("Ver gastos")+"</button></section>");
}
function byDate(a,b) { return ((a.entry_date??'9999')+(a.entry_time??'')).localeCompare((b.entry_date??'9999')+(b.entry_time??'')); }
function calendar() {
  const first = new Date(calendarMonth.getFullYear(),calendarMonth.getMonth(),1,12);
  const start = new Date(first);
  start.setDate(1 - (first.getDay()+6)%7);
  const counts = new Map();
  active('event').forEach(i=>counts.set(i.entry_date,(counts.get(i.entry_date)??0)+1));
  return '<section class="panel"><div class="top"><h2>'+dateLabel(dateKey(first),{month:'long',year:'numeric'})+("</h2><div class=\"actions\"><button class=\"icon-button\" data-month=\"-1\" aria-label=\""+t("Mes anterior")+"\">")+icon('left')+("</button><button class=\"icon-button\" data-month=\"1\" aria-label=\""+t("Mes siguiente")+"\">")+icon('right')+("</button><button data-act=\"calendarToday\">"+t("Hoy")+"</button></div></div>")+
    '<div class="calendar">'+Array.from({length:7},(_,i)=>dateLabel(dateKey(new Date(2024,0,i+1)),{weekday:'short'})).map(d=>'<span class="day-label">'+d+'</span>').join('')+
    Array.from({length:42},(_,i)=>{const day = new Date(start);day.setDate(start.getDate()+i);const key=dateKey(day), count=counts.get(key)??0;
      return '<button class="'+(day.getMonth()===first.getMonth()?'':'outside ') + (key===pickedDay?'selected':'')+'" data-day="'+key+'" aria-pressed="'+(key===pickedDay)+'" aria-label="'+dateLabel(key)+', '+plural(count,'{count} evento','{count} eventos')+'">'+day.getDate()+(count?'<small>'+count+(t(" ev.")+"</small>"):'')+'</button>';}).join('')+'</div></section>';
}
function filtered(kind) {
  const q = filter.trim().toLocaleLowerCase(locale());
  return active(kind).filter(i=>(view!=='event'||i.entry_date===pickedDay)&&(!q||[i.title,i.details,i.category].some(v=>v.toLocaleLowerCase(locale()).includes(q)))&&(status==='all'||i.done===(status==='done')));
}
function listing(kind) {
  const month = dateKey().slice(0,7);
  const total = active('expense').filter(i=>i.entry_date.startsWith(month)).reduce((sum,i)=>sum+Number(i.amount),0);
  return '<p class="muted">'+descriptions[kind]+'</p>'+
    (kind==='event'?calendar():kind==='budget'?budgetSummary():kind==='expense'?("<section class=\"hero\"><small>"+t("Gastos registrados en "))+dateLabel(dateKey(),{month:'long'})+'</small><h2>'+money(total)+'</h2></section>':'')+
    '<section class="panel"><div class="top"><h2>'+(kind==='event'?dateLabel(pickedDay,{weekday:'long',day:'numeric',month:'long'}):t('Registros'))+'</h2></div>'+
    ("<div class=\"filters\"><input id=\"search\" type=\"search\" aria-label=\""+t("Buscar")+"\" placeholder=\""+t("Buscar…")+"\" value=\"")+escape(filter)+'">'+
    (['task','shopping','pet'].includes(kind)?("<select id=\"status\" aria-label=\""+t("Estado")+"\">")+opts([['all',t('Todos')],['open',t('Pendientes')],['done',t('Completados')]],status)+'</select>':'')+
    '</div><div id="results">'+results(kind)+'</div></section>';
}
function results(kind) {
  const data = filtered(kind);
  if(kind==='birthday') data.sort((a,b)=>nextBirthday(a.entry_date,dateKey()).localeCompare(nextBirthday(b.entry_date,dateKey())));
  if(kind==='schedule') data.sort(byDate);
  if (['event','task','meal','pet'].includes(kind)) data.sort(byDate);
  if (kind==='message') data.reverse();
  return data.length ? data.map(row).join('') : emptyState(kind,filter?t('No encontramos coincidencias.'):t('Aún no hay registros.'),filter?'':t('Agregar ')+modules[kind][2]);
}
function row(i) {
  const member = members.find(m=>m.user_id===(i.kind==='message'?i.author:i.assignee));
  const checkable = ['task','shopping','pet'].includes(i.kind);
  const canEdit = i.kind!=='message'||i.author===session.user.id||members.some(m=>m.user_id===session.user.id&&m.role==='owner');
  const birthday=i.kind==='birthday'?nextBirthday(i.entry_date,dateKey()):null;
  const tags = [birthday?plural(daysUntil(birthday,dateKey()),'En {count} día','En {count} días'):'',i.entry_date?dateLabel(i.entry_date):'',i.entry_time?.slice(0,5),i.category,member?.name,i.amount!==null?money(i.amount):''].filter(Boolean);
  return '<article class="row '+(i.done?'checked ':'')+(i.kind==='message'?'message':'')+'">'+
    (checkable?'<input type="checkbox" data-check="'+i.id+'" aria-label="'+escape(t('Completar {title}',{title:i.title}))+'" '+(i.done?'checked':'')+'>':'')+
    '<div class="grow"><div class="title"><strong>'+escape(i.title)+'</strong></div><div class="meta">'+tags.map(tag=>'<span class="pill">'+escape(tag)+'</span>').join('')+'</div>'+
    (i.details?'<p class="detail">'+escape(i.details)+'</p>':'')+(i.attachment_path?'<button data-file="'+i.id+'">'+(i.kind==='photo'?t('Ver archivo'):t('Descargar'))+'</button>':'')+'</div>'+
    (canEdit?'<div class="actions"><button data-edit="'+i.id+'" aria-label="'+escape(t('Editar {title}',{title:i.title}))+'">'+t('Editar')+'</button></div>':'')+'</article>';
}
function openEditor(kind, entry) {
  const hasDate = ['event','task','meal','expense','pet','birthday','schedule','budget'].includes(kind);
  const required = ['event','meal','expense','birthday','schedule','budget'].includes(kind);
  const assignee = ['event','task','pet','schedule'].includes(kind);
  const dateValue = entry ? entry.entry_date : kind==='event'?pickedDay:required?dateKey():'';
  const category = ({shopping:t('Nombre de la lista'),task:t('Nombre de la lista'),meal:t('Momento del día'),expense:t('Categoría'),budget:t('Categoría'),contact:t('Teléfono'),pet:t('Mascota')})[kind];
  editor.innerHTML = '<h2>'+(entry?t('Editar '):t('Agregar '))+modules[kind][2]+'</h2><form data-form="entry" data-kind="'+kind+'" data-id="'+(entry?.id??'')+'">'+
    '<label>'+(kind==='message'?t('Mensaje'):kind==='shopping'?t('Producto'):t('Título'))+'<input name="title" maxlength="160" value="'+escape(entry?.title)+'" required></label>'+
    (category?'<label>'+category+'<input name="category" maxlength="80" value="'+escape(entry?.category)+'"></label>':'')+
    (hasDate?'<div class="split"><label>'+t('Fecha')+'<input name="entry_date" type="date" value="'+escape(dateValue)+'" '+(required?'required':'')+'></label>'+
      (['expense','budget'].includes(kind)?'<label>'+t('Monto en R$')+'<input name="amount" type="number" step="0.01" min="0" max="9999999999.99" value="'+escape(entry?.amount)+'" required></label>':'<label>'+t('Hora')+'<input name="entry_time" type="time" value="'+escape(entry?.entry_time?.slice(0,5))+'"></label>')+'</div>':'')+
    (assignee?("<label>"+t("Responsable")+"<select name=\"assignee\">")+opts([['',t('Sin asignar')],...members.map(m=>[m.user_id,m.name])],entry?.assignee??'')+'</select></label>':'')+
    '<label>'+(({shopping:t('Cantidad o detalles'),recipe:t('Ingredientes y preparación'),contact:t('Correo, dirección y notas')})[kind]||t('Detalles'))+'<textarea name="details" maxlength="4000" rows="3">'+escape(entry?.details)+'</textarea></label>'+
    (fileKinds[kind]&&!entry?'<label>'+t('Selecciona un archivo de hasta 20 MB')+'<input type="file" name="attachment" accept="'+fileKinds[kind].accept+'" required></label>':'')+
    '<p id="form-error" role="alert" class="notice"></p><div class="actions"><button class="primary">'+(kind==='message'&&!entry?t('Enviar'):t('Guardar'))+("</button><button type=\"button\" data-act=\"close\">"+t("Cancelar")+"</button>")+
    (entry?'<button type="button" class="danger" data-archive="'+entry.id+'">'+t('Archivar')+'</button>':'')+'</div></form>';
  editor.showModal(); animateEntry(editor,14);
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
  const [items, people, templates, exceptions, changes] = await Promise.all([
    entryRequest(),result(db.from('casa_members').select('*').eq('household_id',id).order('name')),
    result(db.from('casa_routines').select('*').eq('household_id',id).eq('archived',false).order('starts_on').order('id')),
    result(db.from('casa_routine_days').select('*').eq('household_id',id).in('day',[...new Set([routineDate,dateKey(),tomorrowKey()])])),
    result(db.from('casa_activity').select('*').eq('household_id',id).order('created_at',{ascending:false}).limit(75)),
  ]);
  if (household?.id!==id||version!==refreshVersion) return;
  if (!people.some(m=>m.user_id===session?.user.id)) { await loadHomes(); return; }
  entries=items; members=people; activity=changes; routines=templates; routineDays=exceptions;
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
  household=next; currentInviteLink=''; entries=[]; members=[]; routines=[]; routineDays=[]; routineDate=dateKey(); notice='';
  if (previous) await db.removeChannel(previous);
  if (!next || household?.id!==next.id || !session) { render(); return; }
  localStorage.setItem('casa-home-'+session.user.id,next.id);
  await refresh();
  if (household?.id!==next.id || !members.length) return;
  const config = table=>({event:'*',schema:'public',table,filter:'household_id=eq.'+next.id});
  subscription=db.channel('casa-'+next.id)
    .on('postgres_changes',config('casa_entries'),()=>refresh().catch(e=>show(errorText(e))))
    .on('postgres_changes',config('casa_routines'),()=>refresh().catch(showError))
    .on('postgres_changes',config('casa_routine_days'),()=>refresh().catch(showError))
    .on('postgres_changes',config('casa_members'),()=>refresh().catch(e=>show(errorText(e))))
    .subscribe(state=>{if(state==='SUBSCRIBED') refresh().catch(e=>show(errorText(e)));});
}
async function handleSession(next) {
  const changed=session?.user.id!==next?.user.id;
  session=next;
  if (mode==='reset') {render(); return;}
  if (changed && next) {view='today'; await loadHomes();}
  if (!next) {
    ++generation; household=undefined; entries=[]; members=[]; homes=[]; routines=[]; routineDays=[];
    if(subscription) {const old=subscription; subscription=undefined; await db.removeChannel(old);}
  }
  render();
}
async function submit(form) {
  const values=Object.fromEntries(new FormData(form));
  const type=form.dataset.form;
  if (type==='routine') {
    if (values.second_member && (!values.first_member || values.first_member===values.second_member)) {
      throw new Error('Selecciona dos responsables distintos para alternar.');
    }
    if (values.reminder_minutes && !values.due_time) throw new Error('Indica una hora para el recordatorio.');
    await result(db.from('casa_routines').insert({
      household_id:household.id,title:values.title.trim(),starts_on:values.starts_on,
      every_days:Number(values.every_days),first_member:values.first_member||null,second_member:values.second_member||null,
      due_time:values.due_time||null,reminder_minutes:values.reminder_minutes===''?null:Number(values.reminder_minutes),
    }));
    routineDate=values.starts_on;
    editor.close(); await refresh(); go('routine'); show(t('Guardado.')); return;
  }
  if (type==='routineDay') {
    await result(db.rpc('casa_set_routine_day',{
      h:household.id,r:form.dataset.id,target_day:routineDate,next_status:values.status,next_assignee:values.assignee||null,
    }));
    await refresh(); render(); show(t('Guardado.')); return;
  }
  if (type==='auth') {
    const {email,password}=values;
    if (mode==='login') {
      const data=await result(db.auth.signInWithPassword({email,password})); notice=''; await handleSession(data.session);
    } else if (mode==='signup') {
      const data=await result(db.auth.signUp({email,password,options:{emailRedirectTo:baseUrl()}}));
      mode='login'; notice=data.session?'':t('Revisa tu correo para confirmar la cuenta.'); await handleSession(data.session);
    } else if (mode==='forgot') {
      await result(db.auth.resetPasswordForEmail(email,{redirectTo:baseUrl()}));
      mode='login'; notice=t('Si el correo está registrado, recibirás un enlace de recuperación.'); render();
    } else {
      await result(db.auth.updateUser({password})); mode='login'; notice=t('Contraseña actualizada.'); await loadHomes(); render();
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
  editor.close(); await refresh(); render(); show(t('Guardado.'));
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
  if(el.id==='app-language') {
    if (busy) {el.value=locale(); return;}
    const drafts=[...app.querySelectorAll('form[data-form]')].map(form=>({
      type:form.dataset.form, id:form.dataset.id, values:new FormData(form),
    }));
    setLocale(el.value);
    localizeModules();
    notice='';
    render();
    const forms=[...app.querySelectorAll('form[data-form]')];
    for (const {type,id,values} of drafts) {
      const form=forms.find(item=>item.dataset.form===type && item.dataset.id===id);
      for (const [name,value] of values) {
        const field=form?.elements.namedItem(name);
        if(field) field.value=value;
      }
    }
    document.querySelector('#app-language')?.focus();
  }
  if(el.id==='routine-date' && el.value) {
    if (busy) {el.value=routineDate; return;}
    void run(el,async()=>{
      const previous=routineDate;
      routineDate=el.value;
      try { await refresh(); } catch(error) {routineDate=previous; el.value=previous; throw error;}
      render();
      document.querySelector('#routine-date')?.focus();
    });
  }
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
  if(d.act==='theme') {toggleTheme(); const control=button.querySelector('svg'); if(control) control.outerHTML=icon(currentTheme()==='dark'?'sun':'moon'); button.setAttribute('aria-label',currentTheme()==='dark'?t('Usar tema claro'):t('Usar tema oscuro'));}
  if(d.act==='newRoutine') {
    editor.innerHTML=routineEditor(routineDate,members,opts);
    editor.showModal(); animateEntry(editor,14);
  }
  if(d.routineArchive && confirm(t('¿Archivar esta rutina?'))) void run(button,async()=>{
    await result(db.from('casa_routines').update({archived:true}).eq('household_id',household.id).eq('id',d.routineArchive).select('id').single());
    await refresh(); render();
  });
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
  if(d.act==='shareLocation' && confirm(t('¿Compartir tu ubicación actual con los miembros de este hogar?'))) void run(button,async()=>{
    const coordinates=await memberLocation();
    await result(db.from('casa_entries').insert({household_id:household.id,kind:'location',title:t('Ubicación compartida'),...coordinates}));
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
  if(d.act==='copy') void run(button,async()=>{await navigator.clipboard.writeText(document.querySelector('#invite-link input').value);show(t('Enlace copiado.'));});
  if(d.remove&&confirm(t('¿Quitar a este miembro del hogar?'))) void run(button,async()=>{await result(db.rpc('casa_remove_member',{h:household.id,member_id:d.remove}));await refresh();render();});
  if(d.archive&&confirm(t('¿Archivar este registro?'))) void run(button,async()=>{
    await result(db.from('casa_entries').update({archived:true}).eq('id',d.archive).eq('household_id',household.id).select('id').single());editor.close();await refresh();render();
  });
});
setInterval(updateRoutineNotice,30000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&household) refresh().catch(showError);});
app.textContent=t('Cargando Casa al Día…');
db.auth.onAuthStateChange((event,current)=>{
  if (event==='PASSWORD_RECOVERY') mode='reset';
  if (['INITIAL_SESSION','PASSWORD_RECOVERY','SIGNED_OUT','SIGNED_IN'].includes(event)) {
    setTimeout(()=>{if(event==='SIGNED_IN'&&session?.user.id===current?.user.id)return;handleSession(current).catch(error=>{render();showError(error);});},0);
  }
});

if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('sw.js').catch(console.error);
