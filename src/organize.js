import { t } from './i18n.js';
import { icon } from './presentation.js';

const stages={todo:'Por hacer',doing:'En curso',done:'Hecho'};
const kinds={task:'Tareas',shopping:'Compras'};
const archive = (type,id) => `<button type="button" class="danger" data-org-archive="${type}" data-id="${id}">${t('Archivar')}</button>`;

export function boardsView({boards,board,cards,members,escape,options,dateLabel}) {
  return `<section class="panel"><div class="top">
    ${board ? `<label>${t('Tablero')}<select id="board-select">${options(boards.map(item=>[item.id,item.title]),board.id)}</select></label>` : ''}
    <div class="actions"><button class="primary" data-org="board">${icon('plus')}${t('Nuevo tablero')}</button>
      ${board ? `<button data-org="board" data-id="${board.id}">${t('Editar tablero')}</button>` : ''}</div>
    </div>${board?'':`<p class="muted">${t('Crea un tablero para organizar un proyecto en familia.')}</p>`}</section>
    ${board ? `<div class="kanban">${Object.entries(stages).map(([key,label])=>{
      const column=cards.filter(card=>card.board_id===board.id && card.stage===key);
      return `<section class="kanban-column panel" data-kanban-stage="${key}"><div class="top"><h2>${t(label)} <small>${column.length}</small></h2>
        <button class="icon-button" data-org="card" data-stage="${key}" aria-label="${t('Nueva tarjeta')}">${icon('plus')}</button></div>
        ${column.map(card=>{
          const name=members.find(member=>member.user_id===card.assignee)?.name;
          return `<article class="kanban-card" draggable="true" data-kanban-card="${card.id}">
            <button class="text-button kanban-title" data-org="card" data-id="${card.id}">${escape(card.title)}</button>
            ${card.details?`<p class="detail">${escape(card.details)}</p>`:''}
            <small>${escape([name,card.due_date ? dateLabel(card.due_date) : ''].filter(Boolean).join(' · '))}</small>
            <label>${t('Mover tarjeta')}<select data-card-stage="${card.id}">${options(Object.entries(stages).map(([stage,text])=>[stage,t(text)]),card.stage)}</select></label>
          </article>`;
        }).join('')}${column.length?'':`<p class="muted">${t('Sin tarjetas')}</p>`}</section>`;
    }).join('')}</div>` : ''}`;
}

export function listTemplatesView(templates,escape) {
  return `<section class="panel"><div class="top"><h2>${t('Listas reutilizables')}</h2><button class="primary" data-org="template">${icon('plus')}${t('Nueva plantilla')}</button></div>
    ${templates.length ? templates.map(item=>`<article class="row">
      <div class="grow"><strong>${escape(item.title)}</strong><p class="muted">${t(kinds[item.kind])} · ${item.items.length} ${t('elementos')}</p></div>
      <div class="actions"><button data-org="apply" data-id="${item.id}">${t('Usar plantilla')}</button>
      <button data-org="template" data-id="${item.id}">${t('Editar')}</button></div>
    </article>`).join('') : `<p class="muted">${t('Guarda una lista base para volver a usarla cuando la necesites.')}</p>`}</section>`;
}

export function organizeEditor(type,item,{escape,options,members,stage,boardId}) {
  const titleInput = `<label>${t('Nombre')}<input name="title" required maxlength="${type==='card'?160:80}" value="${escape(item?.title)}"></label>`;
  const editorFields = {
    board:()=>titleInput,
    card:()=>`${titleInput}<label>${t('Detalles')}<textarea name="details" maxlength="4000">${escape(item?.details)}</textarea></label>
      <div class="split"><label>${t('Estado')}<select name="stage">${options(Object.entries(stages).map(([key,label])=>[key,t(label)]),item?.stage||stage||'todo')}</select></label>
      <label>${t('Fecha de entrega')}<input type="date" name="due_date" value="${escape(item?.due_date)}"></label></div>
      <label>${t('Responsable')}<select name="assignee">${options([['',t('Sin asignar')],...members.map(member=>[member.user_id,member.name])],item?.assignee||'')}</select></label>`,
    template:()=>`${titleInput}<label>${t('Tipo de lista')}<select name="kind">${options(Object.entries(kinds).map(([key,label])=>[key,t(label)]),item?.kind||'shopping')}</select></label>
      <label>${t('Elementos, uno por línea')}<textarea name="items" maxlength="8000" rows="6" required>${escape(item?.items.join('\n'))}</textarea></label>`,
    apply:()=>`<p>${escape(item.title)} · ${t(kinds[item.kind])}</p><label>${t('Nombre de la lista')}<input name="title" maxlength="80" required></label>`,
  };
  const titles={board:item?'Editar tablero':'Nuevo tablero',card:item?'Editar tarjeta':'Nueva tarjeta',
    template:item?'Editar plantilla':'Nueva plantilla',apply:'Usar plantilla'};
  return `<h2>${t(titles[type])}</h2><form data-form="organize" data-type="${type}" data-id="${item?.id||''}" data-board="${boardId||''}">
    ${editorFields[type]()}<p id="form-error" role="alert" class="notice"></p><div class="actions">
    <button class="primary">${t(type==='apply'?'Crear lista':'Guardar')}</button><button type="button" data-act="close">${t('Cancelar')}</button>
    ${item && type!=='apply'?archive(type,item.id):''}</div></form>`;
}
