import { t } from './i18n.js';

export function shiftDate(date, days) {
  const local = new Date(date+'T12:00:00');
  local.setDate(local.getDate()+days);
  return [local.getFullYear(),String(local.getMonth()+1).padStart(2,'0'),String(local.getDate()).padStart(2,'0')].join('-');
}

export function ingredients(details) {
  const lines = details.split(/\r?\n/).map(line=>line.trim());
  const start = lines.findIndex(line=>/^ingredientes\s*:?$/i.test(line));
  const candidates = start<0 ? lines.filter(line=>/^[-•*]\s+/.test(line)) : lines.slice(start+1);
  const end = candidates.findIndex(line=>/^(preparaci[oó]n|modo de preparo|preparo|instrucciones)\s*:?$/i.test(line));
  return [...new Set((end<0 ? candidates : candidates.slice(0,end)).map(line=>line.replace(/^[-•*]\s+/,'')).filter(Boolean))];
}

export function recipeAction(recipe,date,escape) {
  const items=ingredients(recipe.details);
  const portions=recipe.flow?.portions ?? 1;
  return `<h2>${t('Usar receta')}</h2><form data-form="recipe-plan" data-id="${recipe.id}">
    <strong>${escape(recipe.title)}</strong>
    <label>${t('Fecha del menú')}<input type="date" name="day" value="${date}"></label>
    <label>${t('Porciones para el menú')}<input type="number" name="portions" min="1" max="100" value="${portions}" required></label>
    <label>${t('Momento del día')}<select name="slot">${['Desayuno','Almuerzo','Cena'].map(slot=>`<option value="${slot}">${t(slot)}</option>`).join('')}</select></label>
    <fieldset><legend>${t('Ingredientes que necesitas comprar')}</legend>
      ${items.length ? items.map((item,index)=>`<label class="recipe-check"><input type="checkbox" name="ingredient" value="${index}"> ${escape(item)}</label>`).join('') :
      `<p>${t('Añade un encabezado Ingredientes y escribe uno por línea en la receta.')}</p>`}
    </fieldset>
    <label>${t('Nombre de la lista')}<input name="list" maxlength="80" value="${t('Mercado')}"></label>
    <p id="form-error" class="notice" role="alert"></p>
    <div class="actions"><button class="primary">${t('Guardar')}</button><button type="button" data-act="close">${t('Cancelar')}</button></div>
  </form>`;
}

export function splitCents(amount, weights) {
  const total = Math.round(Number(amount)*100);
  const positive = weights.filter(([,weight])=>Number.isInteger(weight)&&weight>0);
  if (!positive.length || !Number.isSafeInteger(total) || total<0) return null;
  const sum = positive.reduce((value,[,weight])=>value+weight,0);
  const shares=positive.map(([id,weight])=>{
    const scaled=BigInt(total)*BigInt(weight);
    return {id,cents:Number(scaled/BigInt(sum)),remainder:Number(scaled%BigInt(sum))};
  }).sort((a,b)=>b.remainder-a.remainder);
  const remaining=total-shares.reduce((value,item)=>value+item.cents,0);
  return Object.fromEntries(shares.map((item,index)=>[item.id,item.cents+Number(index<remaining)]));
}

export function expenseFields(item,members,escape) {
  const weights=item?.expense_shares?.weights;
  return `<fieldset><legend>${t('Repartir gasto')}</legend>
    <label class="recipe-check"><input type="checkbox" name="split" ${weights?'checked':''}> ${t('Registrar como gasto compartido')}</label>
    <p>${t('Usa 1 para partes iguales, 0 para excluir y otros valores para repartir en proporción.')}</p>
    ${members.map(member=>`<label>${escape(member.name)}<input type="number" name="share-${member.user_id}" min="0" max="1000" step="1"
      value="${escape(weights?.[member.user_id]??(weights?0:1))}"></label>`).join('')}
  </fieldset>`;
}
