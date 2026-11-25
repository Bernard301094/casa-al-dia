import { t } from './i18n.js';
import { icon } from './presentation.js';

export function occurrence(routine, date, exception) {
  const days = (Date.parse(date)-Date.parse(routine.starts_on))/86400000;
  if (days<0 || days%routine.every_days!==0) return null;
  const second = routine.second_member && days/routine.every_days%2===1;
  return {
    ...routine,
    day:date,
    status:exception?.status ?? 'pending',
    assignee:exception?.assignee ?? (second ? routine.second_member : routine.first_member),
    override:exception?.assignee ?? '',
  };
}

export function routinePanel({date,routines,occurrences,members,escape,options}) {
  const memberOptions = [['',t('Según la rotación')],...members.map(m=>[m.user_id,m.name])];
  return `<section class="panel">
    <div class="top"><label>${t('Fecha')}<input id="routine-date" type="date" value="${escape(date)}"></label>
    <button class="primary" data-act="newRoutine">${icon('plus')}${t('Nueva rutina')}</button></div>
    ${occurrences.length ? occurrences.map(item=>{
      const name=members.find(m=>m.user_id===item.assignee)?.name;
      return `<form class="routine-occurrence" data-form="routineDay" data-id="${item.id}">
        <strong>${escape(item.title)}</strong>
        <small>${escape([item.due_time?.slice(0,5),name || t('Sin asignar')].filter(Boolean).join(' · '))}</small>
        <div class="split"><label>${t('Estado')}<select name="status">${options([
          ['pending',t('Pendiente')],['done',t('Completada')],['skipped',t('Omitida')],
        ],item.status)}</select></label>
        <label>${t('Responsable solo para esta fecha')}<select name="assignee">${options(memberOptions,item.override)}</select></label></div>
        <div><button class="primary">${t('Guardar')}</button></div>
      </form>`;
    }).join('') : `<p class="muted">${t('No hay rutinas para esta fecha.')}</p>`}
  </section>${routines.length ? `<section class="panel"><h2>${t('Rutinas activas')}</h2>${routines.map(item=>`<div class="row">
    <div class="grow"><strong>${escape(item.title)}</strong><br><small>${t(item.every_days===1?'Cada día':'Cada semana')}</small></div>
    <button class="danger" data-routine-archive="${item.id}">${t('Archivar')}</button>
  </div>`).join('')}</section>` : ''}`;
}

export function routineEditor(date,members,options) {
  const assignees=members.map(m=>[m.user_id,m.name]);
  return `<h2>${t('Nueva rutina')}</h2><form data-form="routine">
    <label>${t('Título')}<input name="title" maxlength="160" required></label>
    <div class="split"><label>${t('Fecha de inicio')}<input name="starts_on" type="date" value="${date}" required></label>
    <label>${t('Repetición')}<select name="every_days">${options([['1',t('Cada día')],['7',t('Cada semana')]],'7')}</select></label></div>
    <label>${t('Primer responsable')}<select name="first_member">${options([['',t('Sin asignar')],...assignees],'')}</select></label>
    <label>${t('Alternar con')}<select name="second_member">${options([['',t('Sin rotación')],...assignees],'')}</select></label>
    <div class="split"><label>${t('Hora')}<input name="due_time" type="time"></label>
    <label>${t('Aviso dentro de la app')}<select name="reminder_minutes">${options([
      ['',t('Sin aviso')],['0',t('A la hora')],['15',t('15 minutos antes')],['30',t('30 minutos antes')],['60',t('Una hora antes')],
    ],'')}</select></label></div>
    <p id="form-error" role="alert" class="notice"></p>
    <div class="actions"><button class="primary">${t('Guardar')}</button><button type="button" data-act="close">${t('Cancelar')}</button></div>
  </form>`;
}
