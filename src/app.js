import { connectCalendar, readGoogleEvents } from './google-calendar.js';
import { readCalendar, writeCalendar } from './calendar-files.js';
import { shiftDate, ingredients, recipeAction, splitCents, expenseFields } from './planning.js';
import { syncDateFields } from './date-picker.js';
import { enqueue, enqueueMany, readHome, putHome, getHomes, keepLocalHomes, createLocalHome, replay, queueStatus, getDraft, putDraft, localFile, putFile } from './offline.js';
import { boardsView, listTemplatesView, organizeEditor } from './organize.js';
import { pushConfigured, pushEnabled, enablePush, disablePush, listenForPush } from './push.js';
import { occurrence, routinePanel, routineEditor } from './routines.js';
import { t, locale, setLocale, languageControl, plural } from './i18n.js';
import '@fontsource-variable/dm-sans/wght.css';
import '@fontsource-variable/outfit/wght.css';
import { icon, animateEntry, currentTheme, toggleTheme } from './presentation.js';
import { createClient } from '@supabase/supabase-js';
import { url, key } from './config.js';
import { moduleDetails, fileKinds, nextBirthday, daysUntil, monthKey, memberLocation } from './family.js';

const returnUrl = new URL(location.href);
const fragment = new URLSearchParams(returnUrl.hash.slice(1));
const oauthError = returnUrl.searchParams.get('error') ?? fragment.get('error');
const db = createClient(url, key, {global:{fetch:(input,init={})=>{
  const path=typeof input==='string'?input:input.url;
  const timeout=AbortSignal.timeout(path?.includes('/storage/v1/object/')?120000:12000);
  return fetch(input,{...init,signal:init.signal?AbortSignal.any([init.signal,timeout]):timeout});
}}});
const app = document.querySelector('#app');
const editor = document.querySelector('#editor');
let modules, descriptions;
let googleEvents=[];
function localizeModules() {
  const extras = moduleDetails();
  modules = {
    today: [t('Hoy'),'⌂'], event: [t('Calendario'),'▦',t('evento')], task: [t('Tareas'),'✓',t('tarea')],
    shopping: [t('Compras'),'◫',t('producto')], meal: [t('Comidas'),'♨',t('comida')], expense: [t('Gastos'),'＄',t('gasto')],
    note: [t('Notas'),'▤',t('nota')], pet: [t('Mascotas'),'♡',t('cuidado')],
    family: [t('Mi familia'),'♧'], more: [t('Explorar'),'⋯'],
    deadline:[t('Vencimientos'),'◷',t('vencimiento')], notice:[t('Tablón'),'▤',t('aviso')],
    board: [t('Kanban'),'▥'], routine: [t('Rutinas'),'↻'], lists: [t('Listas'),'☷'], activity: [t('Actividad'),'◉'], location: [t('Mapa'),'⌖'],
    ...extras,
  };
  descriptions = {
    event:t('Organiza los compromisos de la familia.'), task:t('Reparte los pendientes y marca lo que ya hicieron.'),
    shopping:t('Lleva la lista al mercado y actualízala en el momento.'), meal:t('Planifica qué van a comer durante la semana.'),
    expense:t('Registra los gastos compartidos en reales.'), note:t('Guarda información que todos necesiten consultar.'),
    deadline:t('Organiza renovaciones, vacunas y pagos por fecha.'), notice:t('Comparte avisos que todos puedan consultar.'),
    pet:t('Lleva el registro de citas, vacunas y otros cuidados.'),
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
let boards=[], boardCards=[], listTemplates=[], chosenBoard;
const organizationTables={board:'casa_boards',card:'casa_board_cards',template:'casa_list_templates'};
const activeBoard = () => boards.find(board=>board.id===chosenBoard)??boards[0];
let routines = [], routineDays = [];
let view = 'today', filter = '', status = 'all', mode = 'login', notice = oauthError ? t(oauthError==='access_denied'
  ? 'Se canceló el acceso con Google.' : 'No se pudo completar el acceso. Inténtalo de nuevo.') : '';
let syncTask;
let syncStatus={count:0,failed:false};
let localOnly=false;
const lastSessionKey='casa-last-confirmed-user';
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
let agendaWeek=false, agendaKind='all', agendaPerson='all';
let pickedDay = dateKey(), calendarMonth = fromKey(pickedDay);
const money = value => new Intl.NumberFormat(locale(),{style:'currency',currency:'BRL'}).format(value);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brand = '<div class="brand"><img src="casa-icon-192.png?v=9" alt=""> <span>Casa al Día</span></div>';
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
  if (['Selecciona una foto o PDF de hasta 10 MB.','No se encontró texto legible en el documento.',
    'No se pudo leer el documento. Prueba con una imagen más clara o revisa la conexión.'].includes(msg)) return t(msg);
  if (['Elige una fecha o algún ingrediente.','Selecciona un archivo ICS de hasta 2 MB.',
    'El archivo ICS no es válido.','El archivo supera 500 eventos.',
    'No hay eventos nuevos compatibles en el archivo.','Indica quién pagó y agrega al menos una parte.'].includes(msg)) return t(msg);
  if (msg==='List name already in use') return t('Ya existe una lista con ese nombre.');
  if (msg==='Template unavailable') return t('La plantilla ya no está disponible.');
  if (['Escribe un nombre.','Incluye de 1 a 50 elementos de hasta 160 caracteres cada uno.',
    'La plantilla ya no está disponible.'].includes(msg)) return t(msg);
  if (/invalid login credentials/i.test(msg)) return t('Correo o contraseña inválidos.');
  if (/provider is not enabled|unsupported provider/i.test(msg)) return t('El acceso con Google está pendiente de configuración.');
  if (/email not confirmed/i.test(msg)) return t('Confirma tu correo antes de entrar.');
  if (/invalid or expired invitation|invalid input syntax for type uuid/i.test(msg)) return t('El código de invitación venció, ya se usó o no es válido.');
  if (/password/i.test(msg) && /characters|weak/i.test(msg)) return t('Usa una contraseña de al menos 8 caracteres.');
  if (['Este navegador no admite ubicación.',
    'No pudimos obtener tu ubicación. Revisa el permiso del navegador.',
    'El archivo supera el límite de 20 MB.', 'Selecciona dos responsables distintos para alternar.',
    'Indica una hora para el recordatorio.', 'Este navegador no admite avisos push.',
    'Activa el permiso de notificaciones en tu navegador.', 'No se pudo registrar este dispositivo.', 'No se pudo verificar el acceso con Google.'].includes(msg)) return t(msg);
  return t('No se pudo completar la operación.') + (locale()==='es-419' && msg ? ' '+msg : '');
}
async function startGoogle() {
  const settingsResponse=await fetch(url+'/auth/v1/settings',{headers:{apikey:key},cache:'no-store'});
  if (!settingsResponse.ok) throw new Error('No se pudo verificar el acceso con Google.');
  const settings=await settingsResponse.json();
  if (settings.external?.google===false) {
    show(t('El acceso con Google está pendiente de configuración.'));
    return;
  }
  const data=await result(db.auth.signInWithOAuth({
    provider:'google',
    options:{redirectTo:baseUrl(),skipBrowserRedirect:true,queryParams:{prompt:'select_account'}},
  }));
  if (!data.url) throw new Error('No se pudo verificar el acceso con Google.');
  location.assign(data.url);
}
function googleControl() {
  if (window.self !== window.top) {
    return '<a class="google-button external-login" target="_blank" rel="noopener noreferrer" href="'+
      escape(baseUrl())+'">'+t('Abrir Casa al Día en el navegador')+'</a><small>'+
      t('Para entrar con Google, abre la app en una pestaña del navegador.')+'</small>';
  }
  return '<button type="button" class="google-button" data-act="google">'+t('Continuar con Google')+'</button>';
}
function authScreen() {
  const login = mode === 'login', forgot = mode === 'forgot', reset = mode === 'reset';
  const title = reset ? t('Nueva contraseña') : forgot ? t('Recupera tu cuenta') : login ? t('Entra a tu hogar') : t('Crea tu cuenta');
  app.innerHTML = '<div class="auth"><div class="auth-art">'+brand+("<h1>"+t("Organicen su hogar en un solo lugar.")+"</h1><p>"+t("Calendario, compras y pendientes de la familia.")+"</p><div class=\"auth-modules\">")+['event','shopping','routine'].map(kind=>'<span>'+icon(kind)+modules[kind][0]+'</span>').join('')+'</div></div><div class="auth-form"><section><div class="auth-title"><h2>'+title+'</h2>'+themeControl()+'</div>'+languageControl()+'<p id="notice" class="notice" role="status">'+escape(notice)+'</p><form data-form="auth">'+
    (reset?'':("<label>"+t("Correo electrónico")+"<input name=\"email\" type=\"email\" autocomplete=\"email\" required></label>"))+
    (forgot?'':'<label>'+t('Contraseña')+'<input name="password" type="password" minlength="8" autocomplete="'+(login?'current-password':'new-password')+'" required></label>')+
    '<button class="primary">'+(reset?t('Guardar contraseña'):forgot?t('Enviar enlace'):login?t('Entrar'):t('Registrarme'))+'</button></form>'+
    (login||mode==='signup'?googleControl():'')+
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
  const add = descriptions[view] && household ? '<button class="primary" data-new="'+view+'">'+icon('plus')+t('Agregar')+'</button>' : '';
  const invite = sessionStorage.getItem(inviteStorage);
  const top = household ? modules[view][0] : t('Tu hogar');
  app.innerHTML = '<div class="shell"><aside class="side">'+brand+homeBar+
    (household?navigation(['today','event','lists','routine','shopping','meal','more','family'],'nav'):'')+
    '<button class="side-footer" data-act="logout">'+icon('signout')+(t("Cerrar sesión")+"</button></aside><main class=\"content\"><header class=\"page-head\"><div><div class=\"workspace-label\">")+escape(household?.name ?? 'Casa al Día')+'</div><h1>'+top+'</h1></div><div class="actions">'+add+themeControl()+'</div>'+languageControl()+'</header>'+
    '<p id="notice" class="notice" role="status">'+escape(notice)+'</p>'+
    (invite && view!== 'family' && household?("<button data-view=\"family\">"+t("Tienes una invitación pendiente")+"</button>"):'')+
    '<section id="sync-status" class="sync-status" aria-live="polite">'+syncMarkup()+'</section>'+
    '<div id="routine-notice" class="notice" role="status">'+reminderText()+'</div>'+
    (!household || view==='family'?family():view==='today'?dashboard():view==='more'?more():view==='lists'?listHub():view==='activity'?activityPanel():view==='routine'?routinePanel({date:routineDate,routines,occurrences:routinesOn(routineDate),members,escape,options:opts}):view==='location'?locations():view==='board'?boardsView({boards,board:activeBoard(),cards:boardCards,members,escape,options:opts,dateLabel}):listing(view))+
    '</main>'+(household?navigation(['today','event','lists','more'],'bottom'):'')+'</div>';
}
function pushSettings() {
  if (!pushConfigured) return '';
  const enabled=pushEnabled(session.user.id);
  return '<section class="panel"><h2>'+t('Avisos push')+'</h2><p>'+t('Recibe los recordatorios de rutinas en este dispositivo.')+'</p>'+
    '<button data-act="'+(enabled?'disablePush':'enablePush')+'">'+t(enabled?'Desactivar avisos':'Activar avisos')+'</button></section>';
}
function family() {
  const owner = members.some(m=>m.user_id===session.user.id && m.role==='owner');
  const invite = sessionStorage.getItem(inviteStorage) ?? '';
  return '<div class="mobile-homes">'+(homes.length?("<label>"+t("Cambiar de hogar")+"<select id=\"mobile-homes\">")+opts(homes.map(h=>[h.id,h.name]),household?.id)+'</select></label>':'')+'</div><div class="grid">'+(household?("<section class=\"panel\"><h2>"+t("Miembros")+"</h2>")+members.map(m=>'<div class="row"><div class="grow"><strong>'+escape(m.name)+'</strong><p class="muted">'+(m.role==='owner'?t('Administrador'):t('Miembro'))+'</p></div>'+(owner&&m.role==='member'?'<button class="danger" data-remove="'+m.user_id+'">' + t('Quitar') + '</button>':'')+'</div>').join('')+
    (owner?("<button class=\"primary\" data-act=\"invite\">"+t("Generar invitación")+"</button><div id=\"invite-link\">")+inviteMarkup()+'</div>':'')+'</section>':'')+
    ("<section class=\"panel\"><h2>"+t("Crear hogar")+"</h2><form data-form=\"house\"><label>"+t("Nombre del hogar")+"<input name=\"house_name\" maxlength=\"80\" required></label><label>"+t("Tu nombre")+"<input name=\"member_name\" maxlength=\"80\" required></label><button class=\"primary\">"+t("Crear")+"</button></form></section>")+
    ("<section class=\"panel\"><h2>"+t("Unirse a un hogar")+"</h2><form data-form=\"join\"><label>"+t("Código de invitación")+"<input name=\"code\" required value=\"")+escape(invite)+("\"></label><label>"+t("Tu nombre")+"<input name=\"member_name\" maxlength=\"80\" required></label><button class=\"primary\">"+t("Unirme")+"</button></form></section>")+
    pushSettings()+("</div><button data-act=\"logout\">"+t("Cerrar sesión")+"</button>");
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
  const deadlines=active('deadline').filter(item=>!item.done&&item.entry_date<=shiftDate(today,7)&&
    (!item.assignee||item.assignee===session.user.id));
  return [
    due.length ? escape(t('Recordatorio de rutinas'))+': '+due.map(item=>escape(item.title)).join(' · ') : '',
    deadlines.length ? escape(t('Vencimientos'))+': '+deadlines.slice(0,5).map(item=>escape(item.title)).join(' · ') : '',
  ].filter(Boolean).join('<br>');
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
  ['Organización',['lists','board','event','routine','deadline','schedule','birthday','contact','family']],
  ['En familia',['recipe','meal','photo','document','notice','activity','location']],
  ['Hogar',['budget','expense','note','pet']],
];
function exploreTile(kind) {
  return '<button class="module-tile tone-'+kind+'" data-view="'+kind+'"><span class="module-icon">'+icon(kind)+'</span><strong>'+modules[kind][0]+'</strong>'+icon('chevron','tile-chevron')+'</button>';
}
function more() {
  return exploreGroups.map(([label,kinds])=>'<section class="panel explore-section"><h2>'+t(label)+'</h2><div class="module-grid">'+kinds.map(exploreTile).join('')+'</div></section>').join('');
}
function pointsPanel() {
  const totals=new Map();
  for(const item of active('task')) {
    if(item.done&&item.assignee&&item.points) totals.set(item.assignee,(totals.get(item.assignee)||0)+item.points);
  }
  if(!totals.size) return '';
  return '<section class="panel"><h2>'+t('Puntos por tareas')+'</h2>'+members.filter(person=>totals.has(person.user_id))
    .map(person=>'<div class="row"><strong class="grow">'+escape(person.name)+'</strong><span>'+
      totals.get(person.user_id)+'</span></div>').join('')+'</section>';
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
  }).join('')+'</div>'+listTemplatesView(listTemplates,escape)+pointsPanel();
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
const agendaKinds=['event','task','routine','schedule','meal','birthday','deadline'];
function agendaItems(day) {
  const q=filter.trim().toLocaleLowerCase(locale());
  return [
    ...entries.filter(item=>agendaKinds.includes(item.kind)&&!item.archived&&
      (item.kind==='birthday' ? nextBirthday(item.entry_date,day)===day : item.entry_date===day)),
    ...routinesOn(day).filter(item=>item.status!=='skipped').map(item=>({...item,kind:'routine',entry_time:item.due_time})),
  ].filter(item=>(agendaKind==='all'||item.kind===agendaKind) && (agendaPerson==='all'||item.assignee===agendaPerson) &&
    (!q||[item.title,item.details].some(text=>text?.toLocaleLowerCase(locale()).includes(q))))
    .sort((a,b)=>(a.entry_time||'').localeCompare(b.entry_time||''));
}
function agendaRows() {
  return Array.from({length:agendaWeek?7:1},(_,i)=>{
    const day=shiftDate(pickedDay,i), data=agendaItems(day);
    return '<section class="agenda-day"><h3>'+dateLabel(day,{weekday:'long',day:'numeric',month:'long'})+'</h3>'+
      (data.length?data.map(item=>'<div class="row"><small>'+modules[item.kind][0]+'</small><strong class="grow">'+escape(item.title)+'</strong>'+
        '<span>'+escape(item.entry_time?.slice(0,5))+'</span>'+
        (item.kind==='routine'?'<button data-view="routine">'+t('Ver rutinas')+'</button>':'<button data-edit="'+item.id+'">'+t('Editar')+'</button>')+'</div>').join(''):
        '<p class="muted">'+t('Aún no hay registros.')+'</p>')+'</section>';
  }).join('');
}
function showFeed(token) {
  const link=url+'/functions/v1/calendar-feed?key='+encodeURIComponent(token||'');
  editor.innerHTML='<h2>'+t('Suscribir mi calendario')+'</h2><p>'+t('Este enlace da acceso al título, fecha y hora de los eventos del hogar. Compártelo solo con tu servicio de calendario.')+
    '</p><p>'+t('En Google Calendar web, añade otro calendario desde una URL. En Samsung, sincroniza esa misma cuenta Google.')+'</p>'+
    (token?'<label>'+t('Enlace privado')+'<input readonly value="'+escape(link)+'"></label><button data-act="revokeCalendarFeed">'+t('Revocar enlace')+'</button>':
    '<button data-act="createCalendarFeed" class="primary">'+t('Generar enlace privado')+'</button>')+
    '<button data-act="close">'+t('Cerrar')+'</button>';
  if(!editor.open) editor.showModal();
}
function calendar() {
  const first = new Date(calendarMonth.getFullYear(),calendarMonth.getMonth(),1,12);
  const start = new Date(first);
  start.setDate(1 - (first.getDay()+6)%7);
  const counts = new Map();
  for(let i=0;i<42;i++){const day=shiftDate(dateKey(start),i);counts.set(day,agendaItems(day).length);}
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
    (kind==='deadline'?'<section class="hero"><h2>'+t('Próximos 7 días y vencidos')+'</h2>'+
      '<p>'+active('deadline').filter(item=>!item.done&&item.entry_date<=shiftDate(dateKey(),7)).length+'</p></section>':'')+
    (kind==='event'?calendar()+'<section class="panel"><div class="filters"><label>'+t('Vista')+'<select id="agenda-mode">'+opts([['day',t('Día')],['week',t('Semana')]],agendaWeek?'week':'day')+'</select></label><label>'+t('Tipo')+'<select id="agenda-kind">'+opts([['all',t('Todos')],...agendaKinds.map(k=>[k,modules[k][0]])],agendaKind)+'</select></label><label>'+t('Responsable')+'<select id="agenda-person">'+opts([['all',t('Todos')],...members.map(m=>[m.user_id,m.name])],agendaPerson)+'</select></label></div><div class="actions"><button data-act="calendarImport">'+t('Importar ICS')+'</button><button data-act="calendarExport">'+t('Exportar ICS')+'</button><button data-act="scanEvent">'+t('Foto o PDF')+'</button><button data-act="calendarFeed">'+t('Suscribir mi calendario')+'</button><button data-act="googleCalendar">Google Calendar</button></div></section>':kind==='budget'?budgetSummary():kind==='expense'?("<section class=\"hero\"><small>"+t("Gastos registrados en "))+dateLabel(dateKey(),{month:'long'})+'</small><h2>'+money(total)+'</h2></section>':'')+
    '<section class="panel"><div class="top"><h2>'+(kind==='event'?dateLabel(pickedDay,{weekday:'long',day:'numeric',month:'long'}):t('Registros'))+'</h2></div>'+
    ("<div class=\"filters\"><input id=\"search\" type=\"search\" aria-label=\""+t("Buscar")+"\" placeholder=\""+t("Buscar…")+"\" value=\"")+escape(filter)+'">'+
    (['task','shopping','pet','deadline'].includes(kind)?("<select id=\"status\" aria-label=\""+t("Estado")+"\">")+opts([['all',t('Todos')],['open',t('Pendientes')],['done',t('Completados')]],status)+'</select>':'')+
    '</div><div id="results">'+results(kind)+'</div></section>';
}
function results(kind) {
  if(kind==='event') return agendaRows();
  const data = filtered(kind);
  if(kind==='notice') data.sort((a,b)=>Number(b.done)-Number(a.done));
  if(kind==='birthday') data.sort((a,b)=>nextBirthday(a.entry_date,dateKey()).localeCompare(nextBirthday(b.entry_date,dateKey())));
  if(kind==='schedule') data.sort(byDate);
  if (['event','task','meal','pet','deadline'].includes(kind)) data.sort(byDate);
  return data.length ? data.map(row).join('') : emptyState(kind,filter?t('No encontramos coincidencias.'):t('Aún no hay registros.'),filter?'':t('Agregar ')+modules[kind][2]);
}
function row(i) {
  const member = members.find(m=>m.user_id===i.assignee);
  const checkable = ['task','shopping','pet','deadline'].includes(i.kind);
  const birthday=i.kind==='birthday'?nextBirthday(i.entry_date,dateKey()):null;
  const tags = [birthday?plural(daysUntil(birthday,dateKey()),'En {count} día','En {count} días'):'',i.entry_date?dateLabel(i.entry_date):'',i.entry_time?.slice(0,5),i.category,member?.name,i.amount!==null?money(i.amount):''].filter(Boolean);
  return '<article class="row '+(i.done?'checked ':'')+'">'+
    (checkable?'<input type="checkbox" data-check="'+i.id+'" aria-label="'+escape(t('Completar {title}',{title:i.title}))+'" '+(i.done?'checked':'')+'>':'')+
    '<div class="grow"><div class="title"><strong>'+escape(i.title)+'</strong></div><div class="meta">'+tags.map(tag=>'<span class="pill">'+escape(tag)+'</span>').join('')+'</div>'+
    (i.details?'<p class="detail">'+escape(i.details)+'</p>':'')+(i.attachment_path?'<button data-file="'+i.id+'">'+(i.kind==='photo'?t('Ver archivo'):t('Descargar'))+'</button>':'')+'</div>'+
    (i.expense_shares?.shares?'<div class="grow">'+Object.entries(i.expense_shares.shares).filter(([id])=>id!==i.assignee)
      .map(([id,cents])=>'<p>'+escape(members.find(person=>person.user_id===id)?.name||t('Miembro'))+' · '+money(cents/100)+'</p>').join('')+
      '<button data-settled="'+i.id+'">'+t(i.settled?'Marcar pendiente':'Registrar como liquidado')+'</button></div>':'')+
    (i.kind==='notice'?'<button data-pin-notice="'+i.id+'">'+t(i.done?'Desfijar aviso':'Fijar aviso')+'</button>':'')+
    (i.kind==='recipe'?'<button data-recipe="'+i.id+'">'+t('Usar receta')+'</button>':'')+
    '<div class="actions"><button data-edit="'+i.id+'" aria-label="'+escape(t('Editar {title}',{title:i.title}))+'">'+t('Editar')+'</button></div>'+'</article>';
}
function openEditor(kind, entry, source='') {
  const hasDate = ['event','task','meal','expense','pet','birthday','schedule','budget','deadline'].includes(kind);
  const required = ['event','meal','expense','birthday','schedule','budget','deadline'].includes(kind);
  const assignee = ['event','task','pet','schedule','deadline','expense'].includes(kind);
  const dateValue = entry ? entry.entry_date : source==='scan'?'':kind==='event'?pickedDay:required?dateKey():'';
  const category = ({shopping:t('Nombre de la lista'),task:t('Nombre de la lista'),meal:t('Momento del día'),expense:t('Categoría'),budget:t('Categoría'),deadline:t('Categoría'),contact:t('Teléfono'),pet:t('Mascota')})[kind];
  editor.innerHTML = '<h2>'+(source==='scan'?t('Revisar borrador'):(entry?t('Editar '):t('Agregar '))+modules[kind][2])+'</h2><form data-form="entry" data-kind="'+kind+'" data-source="'+source+'" data-id="'+(entry?.id??'')+'">'+
    (source==='scan'?'<p class="muted">'+t('Revisa el título, la fecha y la hora antes de guardar.')+'</p>':'')+
    '<label>'+(kind==='shopping'?t('Producto'):t('Título'))+'<input name="title" maxlength="160" value="'+escape(entry?.title)+'" required></label>'+
    (category?'<label>'+category+'<input name="category" maxlength="80" value="'+escape(entry?.category)+'"></label>':'')+
    (hasDate?'<div class="split"><label>'+t('Fecha')+'<input name="entry_date" type="date" value="'+escape(dateValue)+'" '+(required?'required':'')+'></label>'+
      (['expense','budget'].includes(kind)?'<label>'+t('Monto en R$')+'<input name="amount" type="number" step="0.01" min="0" max="9999999999.99" value="'+escape(entry?.amount)+'" required></label>':'<label>'+t('Hora')+'<input name="entry_time" type="time" value="'+escape(entry?.entry_time?.slice(0,5))+'"></label>')+'</div>':'')+
    (assignee?("<label>"+t(kind==='expense'?'Quién pagó':'Responsable')+"<select name=\"assignee\">")+opts([['',t('Sin asignar')],...members.map(m=>[m.user_id,m.name])],entry?.assignee??'')+'</select></label>':'')+
    '<label>'+(({shopping:t('Cantidad o detalles'),recipe:t('Ingredientes y preparación'),contact:t('Correo, dirección y notas')})[kind]||t('Detalles'))+'<textarea name="details" maxlength="4000" rows="3">'+escape(entry?.details)+'</textarea></label>'+
    (kind==='task'?'<label>'+t('Puntos al completar')+'<input type="number" name="points" min="0" max="100" step="1" value="'+escape(entry?.points??0)+'"></label>':'')+
    (kind==='expense'?expenseFields(entry,members,escape):'')+
    (kind==='deadline'?'<label>'+t('Aviso push')+'<select name="deadline_notice">'+opts([
      ['',t('Sin aviso')],['0',t('El mismo día')],['1',t('Un día antes')],['3',t('Tres días antes')],['7',t('Siete días antes')],
    ],String(entry?.deadline_notice??''))+'</select></label><small>'+t('Si no eliges una hora, el aviso se programa a las 09:00.')+'</small>':'')+
    (fileKinds[kind]&&(!entry||(kind==='deadline'&&entry.author===session.user.id))?'<label>'+
      t(kind==='deadline'?'Adjunto opcional de hasta 20 MB':'Selecciona un archivo de hasta 20 MB')+
      '<input type="file" name="attachment" accept="'+fileKinds[kind].accept+'" '+(kind==='deadline'?'':'required')+'></label>':'')+
    '<p id="form-error" role="alert" class="notice"></p><div class="actions"><button class="primary">'+t('Guardar')+("</button><button type=\"button\" data-act=\"close\">"+t("Cancelar")+"</button>")+
    (entry?'<button type="button" class="danger" data-archive="'+entry.id+'">'+t('Archivar')+'</button>':'')+'</div></form>';
  void showEditor();
}
function syncMarkup() {
  if (syncStatus.failed) return '<span>'+t('Hay cambios guardados en el celular que no se pudieron subir.')+'</span><button data-act="syncNow">'+t('Reintentar')+'</button>';
  if (syncStatus.count) return '<span>'+plural(syncStatus.count,'{count} cambio pendiente de sincronizar','{count} cambios pendientes de sincronizar')+'</span>';
  return localOnly || !navigator.onLine ? '<span>'+t('Sin conexión · datos guardados en este dispositivo')+'</span>' : '';
}
async function updateSyncStatus(user) {
  const status=await queueStatus(user);
  if (session?.user.id!==user) return;
  syncStatus=status;
  const target=document.querySelector('#sync-status');
  if (target) target.innerHTML=syncMarkup();
}
function showSnapshot(data) {
  ({entries,members,activity,routines,days:routineDays,boards,cards:boardCards,lists:listTemplates}=data);
  entries=entries.filter(item=>item.kind!=='message');
  activity=activity.filter(item=>item.kind!=='message');
  const focused=document.activeElement;
  if (focused?.id==='search' && document.querySelector('#results')) document.querySelector('#results').innerHTML=results(view);
  else if (!editor.open && !busy && !app.querySelector('form:focus-within')) render();
}
async function refresh({local=false}={}) {
  if (!household || !session) return;
  const id=household.id,user=session.user.id,version=++refreshVersion;
  const current=()=>household?.id===id && session?.user.id===user && version===refreshVersion;
  const initial=await readHome(user,id);
  if (!current()) return;
  if (initial.members.length || local) showSnapshot(initial);
  if (local || !navigator.onLine || syncTask) return;
  const table=(name)=>db.from(name).select('*').eq('household_id',id);
  async function readAll(query) {
    const all=[];
    for (let offset=0;;offset+=500) {
      const batch=await result(query.range(offset,offset+499));
      all.push(...batch);
      if(batch.length<500) return all;
    }
  }
  try {
    const [entries,members,routines,days,activity,boards,cards,lists]=await Promise.all([
      readAll(table('casa_entries').neq('kind','message').eq('archived',false).order('created_at',{ascending:false}).order('id')),
      result(table('casa_members').order('name')),
      readAll(table('casa_routines').eq('archived',false).order('starts_on').order('id')),
      readAll(table('casa_routine_days').order('day').order('routine_id')),
      result(table('casa_activity').neq('kind','message').order('created_at',{ascending:false}).limit(75)),
      readAll(table('casa_boards').eq('archived',false).order('title').order('id')),
      readAll(table('casa_board_cards').eq('archived',false).order('created_at').order('id')),
      readAll(table('casa_list_templates').eq('archived',false).order('title').order('id')),
    ]);
    if (!current()) return;
    if (!members.some(m=>m.user_id===user)) {
      const cloudHomes=await result(db.from('casa_households').select('id,name').order('name'));
      const pending=await keepLocalHomes(user,cloudHomes);
      if (!pending.some(home=>home.id===id) && current()) await loadHomes();
      return;
    }
    localOnly=false;
    await putHome(user,id,{entries,members,routines,days,activity,boards,cards,lists});
    const data=await readHome(user,id);
    if(current()) showSnapshot(data);
  } catch(error) {
    if (!current()) return;
    if (!initial.members.length) throw error;
    localOnly=true;
    await updateSyncStatus(user);
  }
}
async function loadHomes(preferred,{cachedFirst=false}={}) {
  const ticket=++generation;
  const user=session?.user.id;
  if (!user) return;
  let data=await getHomes(user);
  if(ticket!==generation||session?.user.id!==user) return;
  const saved=localStorage.getItem('casa-home-'+user);
  if (cachedFirst && data?.length) {
    homes=data;
    await selectHouse(homes.find(h=>h.id===saved)??homes[0],{local:true});
    await updateSyncStatus(user);
  }
  if (navigator.onLine) {
    try {
      data=await result(db.from('casa_households').select('id,name').order('name'));
      data=await keepLocalHomes(user,data);
      localStorage.setItem(lastSessionKey,user);
      localOnly=false;
    } catch(error) {
      if (!data) throw error;
      localOnly=true;
    }
  } else localOnly=true;
  if(ticket!==generation||session?.user.id!==user) return;
  homes=data??[];
  const next=homes.find(h=>h.id===(preferred??saved))??homes[0];
  if (!cachedFirst || next?.id!==household?.id || (navigator.onLine && !localOnly)) await selectHouse(next);
  else render();
  await updateSyncStatus(user);
}
async function synchronize() {
  if (syncTask || !navigator.onLine || !session) return;
  const user=session.user.id;
  if (!(await queueStatus(user)).count || syncTask || session?.user.id!==user) return;
  ++refreshVersion;
  syncTask=replay(user,db);
  try { await syncTask; }
  finally { syncTask=undefined; }
  if (session?.user.id===user) {
    await updateSyncStatus(user);
    if (household && !subscription && navigator.onLine) await selectHouse(household);
    else if (household) await refresh();
  }
}
function syncSoon() { void synchronize().catch(showError); }
function draftScope(form) {
  if (!household || !form || ['auth','house','join','scan-event','google-calendar-import'].includes(form.dataset.form)) return '';
  return [household.id,form.dataset.form,form.dataset.type,form.dataset.kind,form.dataset.id,form.dataset.board].join(':')+(form.dataset.source?':'+form.dataset.source:'');
}
async function showEditor() {
  const form=editor.querySelector('form');
  const scope=draftScope(form),user=session?.user.id;
  editor.showModal(); animateEntry(editor,14);
  if (!scope || !user) return;
  try {
    const draft=await getDraft(user,scope);
    if (!draft || !editor.open || !form.isConnected || form.dataset.dirty) return;
    for (const [name,value] of Object.entries(draft.values)) {
      const field=form.elements.namedItem(name);
      if (!field) continue;
      if (field.type==='file' && value instanceof File) {
        const data=new DataTransfer();
        data.items.add(value);
        field.files=data.files;
      } else if (field.type!=='file') field.value=value;
    }
    syncDateFields(form);
  } catch(error) { showError(error); }
}
async function saveEntries(records) {
  if (!records.length) return;
  const user=session.user.id,home=household.id;
  await enqueueMany(records.map(payload=>({user,home,entity:'casa_entries',action:'insert',recordId:crypto.randomUUID(),payload})),
    draftScope(editor.querySelector('form')));
  await refresh({local:true});
  await updateSyncStatus(user);
  setTimeout(syncSoon,0);
}
async function saveLocal(entity,action,recordId,payload,file) {
  const user=session.user.id,home=household.id;
  const scope=editor.open ? draftScope(editor.querySelector('form')) : '';
  await enqueue({user,home,entity,action,recordId,payload,file,scope});
  await refresh({local:true});
  await updateSyncStatus(user);
  setTimeout(syncSoon,0);
  if (navigator.storage?.persist) void navigator.storage.persist().catch(()=>{});
  return recordId;
}
async function selectHouse(next,{local=false}={}) {
  const previous=subscription;
  subscription=undefined;
  if(household?.id!==next?.id) agendaPerson='all';
  household=next; currentInviteLink=''; entries=[]; members=[]; routines=[]; routineDays=[]; routineDate=dateKey(); boards=[]; boardCards=[]; listTemplates=[]; chosenBoard=undefined; notice='';
  if (previous) await db.removeChannel(previous);
  if (!next || household?.id!==next.id || !session) { render(); return; }
  localStorage.setItem('casa-home-'+session.user.id,next.id);
  await refresh({local});
  if (household?.id!==next.id || !members.length || !navigator.onLine || local) return;
  const config = table=>({event:'*',schema:'public',table,filter:'household_id=eq.'+next.id});
  subscription=db.channel('casa-'+next.id)
    .on('postgres_changes',config('casa_entries'),()=>refresh().catch(e=>show(errorText(e))))
    .on('postgres_changes',config('casa_boards'),()=>refresh().catch(showError))
    .on('postgres_changes',config('casa_board_cards'),()=>refresh().catch(showError))
    .on('postgres_changes',config('casa_list_templates'),()=>refresh().catch(showError))
    .on('postgres_changes',config('casa_routines'),()=>refresh().catch(showError))
    .on('postgres_changes',config('casa_routine_days'),()=>refresh().catch(showError))
    .on('postgres_changes',config('casa_members'),()=>refresh().catch(e=>show(errorText(e))))
    .subscribe(state=>{if(state==='SUBSCRIBED') refresh().catch(e=>show(errorText(e)));});
}
async function handleSession(next) {
  const changed=session?.user.id!==next?.user.id;
  session=next;
  if (mode==='reset') {render(); return;}
  if (changed && next) {agendaPerson='all';view='today'; await loadHomes(undefined,{cachedFirst:true}); void listenForPush(next.user.id,show).catch(()=>{});syncSoon();}
  if (!next) {
    ++generation; syncStatus={count:0,failed:false}; household=undefined; entries=[]; members=[]; homes=[]; routines=[]; routineDays=[]; boards=[]; boardCards=[]; listTemplates=[]; chosenBoard=undefined;
    if(subscription) {const old=subscription; subscription=undefined; await db.removeChannel(old);}
  }
  render();
}
async function submit(form) {
  const values=Object.fromEntries(new FormData(form));
  const type=form.dataset.form;
  if (type==='scan-event') {
    const file=values.source_file;
    if (!file?.size || file.size>10000000) throw new Error('Selecciona una foto o PDF de hasta 10 MB.');
    editor.querySelector('#form-error').textContent=t('Leyendo el documento…');
    let extracted,suggest;
    try {
      const reader=await import(new URL('document-reader/index.js?v=1',baseUrl()).href);
      extracted=await reader.extractDocument(file);
      suggest=reader.suggestEvent;
    } catch {
      throw new Error('No se pudo leer el documento. Prueba con una imagen más clara o revisa la conexión.');
    }
    if (!extracted.text.trim()) throw new Error('No se encontró texto legible en el documento.');
    const draft=suggest(extracted.text);
    const scope=household.id+':entry::event:::scan';
    await putDraft(session.user.id,scope,draft);
    editor.close();
    openEditor('event',undefined,'scan');
    if(extracted.truncated) editor.querySelector('#form-error').textContent=t('Se leyeron las primeras tres páginas.');
    return;
  }
  if(type==='google-calendar-import') {
    const chosen=new FormData(form).getAll('event').map(index=>googleEvents[Number(index)]).filter(Boolean);
    await saveEntries(chosen); googleEvents=[]; editor.close();render();show(t('Guardado.'));return;
  }
  if (type==='calendar-import') {
    const file=values.calendar;
    if (!file?.size || file.size>2000000) throw new Error('Selecciona un archivo ICS de hasta 2 MB.');
    let parsed;
    try {parsed=readCalendar(await file.text());} catch {throw new Error('El archivo ICS no es válido.');}
    if (parsed.events.length>500) throw new Error('El archivo supera 500 eventos.');
    const seen=new Set(active('event').map(item=>[item.title,item.entry_date,item.entry_time?.slice(0,5)||''].join('|')));
    const records=parsed.events.filter(item=>{
      const signature=[item.title,item.entry_date,item.entry_time||''].join('|');
      if(seen.has(signature)) return false;
      seen.add(signature);return true;
    });
    if (!records.length) throw new Error('No hay eventos nuevos compatibles en el archivo.');
    await saveEntries(records);
    editor.close();render();
    show(t('Eventos importados: {count}. Omitidos: {skipped}.',{count:records.length,skipped:parsed.skipped+parsed.events.length-records.length}));
    return;
  }
  if (type==='recipe-plan') {
    const recipe=entries.find(item=>item.id===form.dataset.id&&item.kind==='recipe');
    if (!recipe) return;
    const available=ingredients(recipe.details);
    const selected=new FormData(form).getAll('ingredient').map(index=>available[Number(index)]).filter(Boolean);
    if (!values.day&&!selected.length) throw new Error('Elige una fecha o algún ingrediente.');
    const category=values.list.trim()||t('Mercado');
    const existing=new Set(active('shopping').filter(item=>!item.done&&item.category===category).map(item=>item.title.toLocaleLowerCase(locale())));
    const records=values.day?[{kind:'meal',title:recipe.title,entry_date:values.day}]:[];
    for(const title of selected) {
      if(existing.has(title.toLocaleLowerCase(locale()))) continue;
      records.push({kind:'shopping',title,category});
      existing.add(title.toLocaleLowerCase(locale()));
    }
    await saveEntries(records);
    editor.close();render();show(t('Guardado.'));return;
  }
  if (type==='organize') {
    await saveOrganization(form,values);
    return;
  }
  if (type==='routine') {
    if (values.second_member && (!values.first_member || values.first_member===values.second_member)) {
      throw new Error('Selecciona dos responsables distintos para alternar.');
    }
    if (values.reminder_minutes && !values.due_time) throw new Error('Indica una hora para el recordatorio.');
    await saveLocal('casa_routines','insert',crypto.randomUUID(),{
      title:values.title.trim(),starts_on:values.starts_on,
      every_days:Number(values.every_days),first_member:values.first_member||null,second_member:values.second_member||null,
      due_time:values.due_time||null,reminder_minutes:values.reminder_minutes===''?null:Number(values.reminder_minutes),
    });
    routineDate=values.starts_on;
    editor.close(); go('routine'); show(t('Guardado.')); return;
  }
  if (type==='routineDay') {
    await saveLocal('casa_routine_days','routineDay',form.dataset.id,{
      day:routineDate,status:values.status,assignee:values.assignee||null,
    });
     render(); show(t('Guardado.')); return;
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
  if (type==='house') {
    const houseName=values.house_name.trim(),memberName=values.member_name.trim();
    if (!houseName || !memberName) throw new Error('Escribe un nombre.');
    const localHome=await createLocalHome(session.user.id,houseName,memberName);
    homes=[...homes,localHome];
    await selectHouse(localHome,{local:true}); go('today'); await updateSyncStatus(session.user.id); syncSoon();
    return;
  }
  if (type==='join') {
    if (!navigator.onLine) return show(t('Para completar esta acción necesitas conexión.'));
    const id=await result(db.rpc('casa_join_household',values));
    sessionStorage.removeItem(inviteStorage);
    await loadHomes(id); go('today'); return;
  }
  const payload={
    title:values.title.trim(), details:values.details.trim(), category:values.category?.trim()??'',
    entry_date:values.entry_date||null, entry_time:values.entry_time||null, amount:values.amount||null, assignee:values.assignee||null,
  };
  const id = form.dataset.id;
  if(form.dataset.kind==='task') payload.points=Number(values.points||0);
  if(form.dataset.kind==='expense') {
    const weights=members.map(member=>[member.user_id,Number(values['share-'+member.user_id]||0)]);
    const shares=values.split?splitCents(payload.amount,weights):null;
    if(values.split&&(!shares||!payload.assignee)) throw new Error('Indica quién pagó y agrega al menos una parte.');
    payload.expense_shares=shares?{weights:Object.fromEntries(weights),shares}:null;
    const existing=entries.find(item=>item.id===id);
    if(existing&&(Number(existing.amount)!==Number(payload.amount)||existing.assignee!==payload.assignee||
      JSON.stringify(existing.expense_shares?.weights??null)!==JSON.stringify(payload.expense_shares?.weights??null))) payload.settled=false;
  }
  const kind=form.dataset.kind;
  if (kind==='deadline') payload.deadline_notice=values.deadline_notice===''?null:Number(values.deadline_notice);
  const recordId=id||crypto.randomUUID();
  const file=form.querySelector('input[type=file]')?.files[0];
  let attachment;
  if (file) {
    if(file.size>20971520) throw new Error('El archivo supera el límite de 20 MB.');
    const extension=file.name.split('.').at(-1).replace(/[^a-z0-9]/gi,'').slice(0,10);
    const path=household.id+'/'+session.user.id+'/'+crypto.randomUUID()+(extension?'.'+extension:'');
    attachment={bucket:fileKinds[kind].bucket,path,blob:file};
    Object.assign(payload,{attachment_path:path,attachment_name:file.name});
  }
  await saveLocal('casa_entries',id?'update':'insert',recordId,id?payload:{...payload,kind},attachment);
  if (form.dataset.kind==='event' && payload.entry_date) {
    pickedDay=payload.entry_date; calendarMonth=fromKey(pickedDay);
  }
  editor.close(); render(); show(t('Guardado.'));
}
async function saveOrganization(form,values) {
  const {type,id}=form.dataset;
  const title=values.title.trim();
  if (!title) throw new Error('Escribe un nombre.');
  if (type==='apply') {
    const template=listTemplates.find(item=>item.id===id);
    if (!template) throw new Error('La plantilla ya no está disponible.');
    if (entries.some(item=>item.kind===template.kind && item.category.toLocaleLowerCase()===title.toLocaleLowerCase())) {
      throw new Error('List name already in use');
    }
    await saveLocal('casa_entries','batch',crypto.randomUUID(),{
      kind:template.kind,category:title,items:template.items.map(title=>({id:crypto.randomUUID(),title})),
    });
    editor.close(); go(template.kind); filter=title; render(); show(t('Lista creada.'));
    return;
  }
  let record={title};
  if (type==='card') {
    record={...record,details:values.details.trim(),stage:values.stage,due_date:values.due_date||null,assignee:values.assignee||null};
  }
  if (type==='template') {
    const items=values.items.split(/\r?\n/).map(item=>item.trim()).filter(Boolean);
    if (!items.length || items.length>50 || items.some(item=>item.length>160)) {
      throw new Error('Incluye de 1 a 50 elementos de hasta 160 caracteres cada uno.');
    }
    record={...record,kind:values.kind,items};
  }
  const recordId=id||crypto.randomUUID();
  if(type==='card'&&!id) record.board_id=form.dataset.board;
  await saveLocal(organizationTables[type],id?'update':'insert',recordId,record);
  if (type==='board') chosenBoard=recordId;
  editor.close(); render(); show(t('Guardado.'));
}
async function moveCard(card,stage) {
  if (card.stage===stage) return;
  const patch={stage};
  if(card.assignee&&!members.some(item=>item.user_id===card.assignee)) patch.assignee=null;
  await saveLocal('casa_board_cards','update',card.id,patch);render();show(t('Tarjeta movida.'));
  document.querySelector('[data-card-stage="'+card.id+'"]')?.focus();
}

let draggedCard;
document.addEventListener('dragstart',event=>{
  const tile=event.target.closest('[data-kanban-card]');
  if (!tile || busy) return;
  draggedCard=tile.dataset.kanbanCard;
  event.dataTransfer.effectAllowed='move';
  event.dataTransfer.setData('text/plain',draggedCard);
});
document.addEventListener('dragover',event=>{
  if (draggedCard && !busy && event.target.closest('[data-kanban-stage]')) {
    event.preventDefault();
    event.dataTransfer.dropEffect='move';
  }
});
document.addEventListener('drop',event=>{
  const column=event.target.closest('[data-kanban-stage]');
  if (!draggedCard || !column || busy) return;
  event.preventDefault();
  const card=boardCards.find(item=>item.id===draggedCard && item.board_id===activeBoard()?.id);
  draggedCard=undefined;
  if(card) void run(null,()=>moveCard(card,column.dataset.kanbanStage));
});
document.addEventListener('dragend',()=>{draggedCard=undefined;});
function showError(error) {
  if (error?.name==='QuotaExceededError') {
    const message=t('No hay espacio suficiente en el dispositivo.');
    const target=editor.open&&editor.querySelector('#form-error');
    if (target) target.textContent=message; else show(message);
    return;
  }
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
function persistEditor(event) {
  const form=event.target.closest('#editor form');
  const scope=draftScope(form);
  if (!scope || !session) return;
  form.dataset.dirty='true';
  const values=Object.fromEntries([...new FormData(form)].filter(([,value])=>!(value instanceof File)||value.name));
  void putDraft(session.user.id,scope,values).catch(showError);
}
document.addEventListener('change',persistEditor);
document.addEventListener('input',event=>{
  persistEditor(event);
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
  if(el.id==='agenda-mode') {agendaWeek=el.value==='week';render();document.querySelector('#agenda-mode')?.focus();}
  if(el.id==='agenda-person') {agendaPerson=el.value;render();document.querySelector('#agenda-person')?.focus();}
  if(el.id==='agenda-kind') {agendaKind=el.value;render();document.querySelector('#agenda-kind')?.focus();}
  if(el.id==='board-select') {
    chosenBoard=el.value; render(); document.querySelector('#board-select')?.focus();
  }
  if(el.dataset.cardStage) {
    const card=boardCards.find(item=>item.id===el.dataset.cardStage);
    if (!card || busy) { if(card) el.value=card.stage; return; }
    const stage=el.value;
    void run(el,async()=>{
      try { await moveCard(card,stage); }
      catch(error) { el.value=card.stage; throw error; }
    });
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
      try {await saveLocal('casa_entries','update',el.dataset.check,{done:checked});}
      catch(error) {el.checked=!checked; throw error;}
      render();
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
  if(d.settled) void run(button,async()=>{
    const item=entries.find(i=>i.id===d.settled&&i.kind==='expense');
    if(item){await saveLocal('casa_entries','update',item.id,{settled:!item.settled});render();}
  });
  if(d.pinNotice) void run(button,async()=>{
    const item=entries.find(i=>i.id===d.pinNotice&&i.kind==='notice');
    if(item) {await saveLocal('casa_entries','update',item.id,{done:!item.done});render();}
  });
  if(d.recipe) {const recipe=entries.find(item=>item.id===d.recipe); if(recipe){editor.innerHTML=recipeAction(recipe,dateKey(),escape);void showEditor();}}
  if(d.edit) {const entry=entries.find(i=>i.id===d.edit);if(entry) openEditor(entry.kind,entry);}
  if(d.day) {pickedDay=d.day; calendarMonth=fromKey(pickedDay);render();}
  if(d.month) {calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+Number(d.month),1,12);pickedDay=dateKey(calendarMonth);render();}
  if(d.act==='calendarFeed') void run(button,async()=>{
    const filterFeed=()=>db.from('casa_calendar_feeds').select('token').eq('household_id',household.id).eq('user_id',session.user.id);
    const feed=await result(filterFeed().maybeSingle());
    showFeed(feed?.token);
  });
  if(d.act==='createCalendarFeed') void run(button,async()=>{
    const feed=await result(db.from('casa_calendar_feeds').insert({household_id:household.id,user_id:session.user.id}).select('token').single());
    showFeed(feed.token);
  });
  if(d.act==='revokeCalendarFeed') void run(button,async()=>{
    await result(db.from('casa_calendar_feeds').delete().eq('household_id',household.id).eq('user_id',session.user.id));
    showFeed();
  });
  if(d.act==='googleCalendar') void run(button,async()=>{
    const {data:{session:current}}=await db.auth.getSession();
    const expected=sessionStorage.getItem('casa-calendar-user');
    if (expected && expected!==session.user.id) {
      sessionStorage.removeItem('casa-calendar-user');
      show(t('Vuelve a entrar con la cuenta de tu hogar para importar eventos.'));
      return;
    }
    if (!expected||!current?.provider_token) {
      sessionStorage.setItem('casa-calendar-user',session.user.id);
      await connectCalendar(db.auth,baseUrl());
      return;
    }
    const result=await readGoogleEvents(current.provider_token);
    const signature=item=>JSON.stringify([item.title,item.entry_date,item.entry_time?.slice(0,5)||'']);
    const known=new Set(active('event').map(signature));
    googleEvents=result.events.filter(item=>{
      const key=signature(item);if(known.has(key))return false;known.add(key);return true;
    });
    editor.innerHTML='<h2>Google Calendar</h2><form data-form="google-calendar-import"><p>'+
      t('Marca los eventos que quieres compartir con tu hogar.')+'</p>'+
      (result.more?'<p>'+t('Se muestran hasta 250 eventos.')+'</p>':'')+
      googleEvents.map((item,index)=>'<label class="recipe-check"><input type="checkbox" name="event" value="'+index+'">'+
        escape(item.title)+' · '+dateLabel(item.entry_date)+' '+escape(item.entry_time)+'</label>').join('')+
      (googleEvents.length?'<button class="primary">'+t('Importar eventos')+'</button>':'<p>'+t('Aún no hay registros.')+'</p>')+
      '<button type="button" data-act="close">'+t('Cancelar')+'</button></form>';
    editor.showModal();
  });
  if(d.act==='scanEvent') void run(button,async()=>{
    const draft=await getDraft(session.user.id,household.id+':entry::event:::scan');
    editor.innerHTML='<h2>'+t('Foto o PDF')+'</h2><form data-form="scan-event"><p>'+t('El documento se procesa en este dispositivo. Se leen hasta tres páginas del PDF.')+'</p>'+
      '<label>'+t('Selecciona una foto o PDF de hasta 10 MB.')+'<input type="file" name="source_file" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" required></label>'+
      '<p id="form-error" class="notice" role="status"></p><div class="actions"><button class="primary">'+t('Extraer texto')+'</button>'+
      (draft?'<button type="button" data-act="resumeScan">'+t('Retomar borrador')+'</button>':'')+
      '<button type="button" data-act="close">'+t('Cancelar')+'</button></div></form>';
    void showEditor();
  });
  if(d.act==='resumeScan') {editor.close();openEditor('event',undefined,'scan');}
  if(d.act==='calendarImport') {
    editor.innerHTML='<h2>'+t('Importar ICS')+'</h2><form data-form="calendar-import"><p>'+t('Se importan eventos individuales. Las repeticiones se omiten.')+
      '</p><label>ICS<input type="file" name="calendar" accept=".ics,text/calendar" required></label><p id="form-error" class="notice" role="alert"></p>'+
      '<div class="actions"><button class="primary">'+t('Importar ICS')+'</button><button type="button" data-act="close">'+t('Cancelar')+'</button></div></form>';
    void showEditor();
  }
  if(d.act==='calendarExport') {
    const link=document.createElement('a');
    const url=URL.createObjectURL(new Blob([writeCalendar(active('event'))],{type:'text/calendar;charset=utf-8'}));
    link.href=url;link.download='casa-al-dia.ics';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  if(d.act==='calendarToday') {pickedDay=dateKey();calendarMonth=fromKey(pickedDay);render();}
  if(d.act==='theme') {toggleTheme(); const control=button.querySelector('svg'); if(control) control.outerHTML=icon(currentTheme()==='dark'?'sun':'moon'); button.setAttribute('aria-label',currentTheme()==='dark'?t('Usar tema claro'):t('Usar tema oscuro'));}
  if(d.org) {
    const records={board:boards,card:boardCards,template:listTemplates,apply:listTemplates};
    const item=records[d.org]?.find(entry=>entry.id===d.id);
    if (!d.id || item) {
      editor.innerHTML=organizeEditor(d.org,item,{escape,options:opts,members,stage:d.stage,boardId:item?.board_id??activeBoard()?.id});
      void showEditor();
    }
  }
  if(d.orgArchive&&confirm(t('¿Archivar este registro?'))) void run(button,async()=>{
    const patch={archived:true};
    const card=d.orgArchive==='card'&&boardCards.find(item=>item.id===d.id);
    if (card?.assignee&&!members.some(item=>item.user_id===card.assignee)) patch.assignee=null;
    await saveLocal(organizationTables[d.orgArchive],'update',d.id,patch);
    editor.close();render();
  });
  if(d.act==='newRoutine') {
    editor.innerHTML=routineEditor(routineDate,members,opts);
    void showEditor();
  }
  if(d.routineArchive && confirm(t('¿Archivar esta rutina?'))) void run(button,async()=>{
    await saveLocal('casa_routines','update',d.routineArchive,{archived:true});
    render();
  });
  if(d.act==='syncNow') syncSoon();
  if(d.act==='close') editor.close();
  if(d.act==='google') void run(button,startGoogle);

  if(d.file) void run(button,async()=>{
    const item=entries.find(i=>i.id===d.file);
    if (!item) return;
    const local=await localFile(session.user.id,household.id,item.attachment_path);
    if (local) {
      const link=document.createElement('a');
      const objectUrl=URL.createObjectURL(local);
      link.href=objectUrl;link.download=item.attachment_name;link.click();
      setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
      return;
    }
    const params=item.kind!=='photo'?{download:item.attachment_name}:{};
    const owner=session.user.id,home=household.id;
    const {signedUrl}=await result(db.storage.from(fileKinds[item.kind].bucket).createSignedUrl(item.attachment_path,60,params));
    void fetch(signedUrl).then(response=>response.ok?response.blob():null)
      .then(blob=>blob&&putFile(owner,home,item.attachment_path,blob)).catch(()=>{});
    const link=document.createElement('a');
    link.href=signedUrl; link.target='_blank'; link.rel='noopener noreferrer'; link.click();
  });
  if(d.act==='shareLocation' && confirm(t('¿Compartir tu ubicación actual con los miembros de este hogar?'))) void run(button,async()=>{
    const coordinates=await memberLocation();
    await saveLocal('casa_entries','insert',crypto.randomUUID(),{kind:'location',title:t('Ubicación compartida'),...coordinates});
    render();
  });
  if(d.act==='removeLocation') void run(button,async()=>{
    await saveLocal('casa_entries','withdrawLocation',crypto.randomUUID(),{});
    render();
  });
  if(d.act==='enablePush') void run(button,async()=>{await enablePush(session.user.id,db,show);render();show(t('Dispositivo registrado para recibir avisos.'));});
  if(d.act==='disablePush') void run(button,async()=>{await disablePush(session.user.id,db);render();show(t('Avisos desactivados en este dispositivo.'));});
  if(d.act==='logout') void run(button,async()=>{await disablePush(session.user.id,db);await result(db.auth.signOut());localStorage.removeItem(lastSessionKey);sessionStorage.removeItem('casa-calendar-user');googleEvents=[];mode='login';notice='';await handleSession(null);});
  if(d.act==='invite') void run(button,async()=>{
    const code=await result(db.rpc('casa_create_invite',{h:household.id}));
    const link=new URL(baseUrl());link.searchParams.set('invitar',code);
    currentInviteLink=link.href; document.querySelector('#invite-link').innerHTML=inviteMarkup();
  });
  if(d.act==='copy') void run(button,async()=>{await navigator.clipboard.writeText(document.querySelector('#invite-link input').value);show(t('Enlace copiado.'));});
  if(d.remove&&confirm(t('¿Quitar a este miembro del hogar?'))) void run(button,async()=>{await result(db.rpc('casa_remove_member',{h:household.id,member_id:d.remove}));await refresh();render();});
  if(d.archive&&confirm(t('¿Archivar este registro?'))) void run(button,async()=>{
    await saveLocal('casa_entries','update',d.archive,{archived:true});editor.close();render();
  });
});
setInterval(()=>{
  updateRoutineNotice();
  if (document.visibilityState==='visible') syncSoon();
},30000);
window.addEventListener('online',()=>{localOnly=false; syncSoon(); if(household) (subscription?refresh():selectHouse(household)).catch(showError);});
window.addEventListener('offline',()=>{localOnly=true; if(session) void updateSyncStatus(session.user.id);});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&household) {syncSoon();refresh().catch(showError);}});
app.textContent=t('Cargando Casa al Día…');
db.auth.onAuthStateChange((event,current)=>{
  if (event==='PASSWORD_RECOVERY') mode='reset';
  if (['INITIAL_SESSION','PASSWORD_RECOVERY','SIGNED_OUT','SIGNED_IN'].includes(event)) {
    if (event==='INITIAL_SESSION' && oauthError) {
      const clean=new URL(location.href);
      for (const key of ['error','error_code','error_description']) clean.searchParams.delete(key);
      if (new URLSearchParams(clean.hash.slice(1)).has('error')) clean.hash='';
      history.replaceState(null,'',clean);
    }
    setTimeout(()=>{if(event==='SIGNED_IN'&&session?.user.id===current?.user.id)return;const cached=event==='INITIAL_SESSION' && !navigator.onLine && !current && localStorage.getItem(lastSessionKey);
      if (event==='SIGNED_OUT') localStorage.removeItem(lastSessionKey);
      handleSession(cached ? {user:{id:cached}} : current).catch(error=>{render();showError(error);});},0);
  }
});

if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).catch(console.error);
