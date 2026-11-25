import { locale, t } from './i18n.js';
import { icon } from './presentation.js';

const key = date => [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
const parse = value => new Date(value+'T12:00:00');
const format = (date, options) => new Intl.DateTimeFormat(locale(),options).format(date);
const picker = document.createElement('dialog');
picker.className = 'date-picker';
picker.setAttribute('aria-labelledby','date-picker-title');
document.body.append(picker);

export function syncDateFields(root) {
  for (const field of root.querySelectorAll('input[type="date"]')) {
    const button = field.nextElementSibling;
    if (!button?.matches('.date-trigger')) continue;
    button.firstElementChild.textContent = field.value
      ? format(parse(field.value),{dateStyle:'medium'}) : t('Elegir fecha');
  }
}

function enhanceDateFields(root) {
  for (const field of root.querySelectorAll('input[type="date"]:not(.date-value)')) {
    field.classList.add('date-value');
    field.tabIndex = -1;
    field.setAttribute('aria-hidden','true');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'date-trigger';
    button.setAttribute('aria-haspopup','dialog');
    button.innerHTML = '<span></span>'+icon('calendar');
    field.after(button);
    button.addEventListener('click',()=>openPicker(field,button));
    field.addEventListener('invalid',event=>{
      event.preventDefault();
      if (!picker.open) openPicker(field,button);
    });
  }
  syncDateFields(root);
}
for (const root of [document.querySelector('#app'),document.querySelector('#editor')]) {
  new MutationObserver(records=>{
    if (records.some(record=>[...record.addedNodes].some(node=>node.nodeType===1 && !node.matches('.date-trigger')))) {
      enhanceDateFields(root);
    }
  }).observe(root,{childList:true,subtree:true});
}

function openPicker(field,trigger) {
  const today = key(new Date());
  let shown = parse(field.value || today);
  shown.setDate(1);
  const select = value => {
    field.value = value;
    syncDateFields(field.parentElement);
    picker.close();
    field.dispatchEvent(new Event('input',{bubbles:true}));
    field.dispatchEvent(new Event('change',{bubbles:true}));
  };
  function render() {
    const year=shown.getFullYear(),month=shown.getMonth();
    const offset=(shown.getDay()+6)%7;
    const monthName=format(shown,{month:'long',year:'numeric'});
    picker.innerHTML = `<h2 id="date-picker-title">${t('Elegir fecha')}</h2>
      <div class="date-picker-header">
        <button type="button" data-month="-1" aria-label="${t('Mes anterior')}">${icon('left')}</button>
        <strong aria-live="polite">${monthName}</strong>
        <button type="button" data-month="1" aria-label="${t('Mes siguiente')}">${icon('right')}</button>
      </div>
      <div class="date-picker-grid">
        ${Array.from({length:7},(_,i)=>'<small>'+format(new Date(2024,0,i+1),{weekday:'short'})+'</small>').join('')}
        ${Array.from({length:42},(_,i)=>{
          const day = new Date(year,month,i-offset+1,12);
          const value=key(day);
          return `<button type="button" data-date="${value}" class="${day.getMonth()===month?'':'outside'}"
            aria-label="${format(day,{dateStyle:'full'})}" aria-pressed="${value===field.value}" ${value===today?'aria-current="date"':''}>${day.getDate()}</button>`;
        }).join('')}
      </div>
      <div class="date-picker-actions">
        <button type="button" data-today>${t('Hoy')}</button>
        ${field.required||field.id==='routine-date'?'':`<button type="button" data-clear>${t('Quitar fecha')}</button>`}
        <button type="button" data-cancel>${t('Cancelar')}</button>
      </div>`;
  }
  picker.onclick=event=>{
    const button=event.target.closest('button');
    if (!button) return;
    if (button.dataset.month) {
      shown.setMonth(shown.getMonth()+Number(button.dataset.month));
      render();
      picker.querySelector('[data-month="'+button.dataset.month+'"]').focus();
    } else if (button.dataset.date) select(button.dataset.date);
    else if (button.hasAttribute('data-today')) select(today);
    else if (button.hasAttribute('data-clear')) select('');
    else picker.close();
  };
  picker.addEventListener('close',()=>{if(trigger.isConnected) trigger.focus();},{once:true});
  render();
  picker.showModal();
  (picker.querySelector('[aria-pressed="true"]')??picker.querySelector('[aria-current="date"]')??picker.querySelector('[data-month]')).focus();
}
