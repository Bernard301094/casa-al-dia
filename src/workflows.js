import { shiftDate } from './planning.js';

const dayNumber = day => Date.parse(day + 'T00:00:00Z') / 86400000;

export function occursOn(event, day) {
  const start = event.entry_date;
  if (!start || day < start) return false;
  if (day === start) return true;
  const { repeat, until } = event.flow ?? {};
  if (!until || day > until) return false;
  if (repeat === 'daily') return true;
  if (repeat === 'weekly') return (dayNumber(day) - dayNumber(start)) % 7 === 0;
  return repeat === 'monthly' && day.slice(-2) === start.slice(-2);
}

export function eventTimes(event) {
  const allDay = !event.entry_time;
  const start = new Date(event.entry_date + 'T' + (event.entry_time || '00:00'));
  const end = allDay ? new Date(shiftDate(event.entry_date, 1) + 'T00:00') :
    new Date(+start + (event.flow?.minutes ?? 60) * 60000);
  return { allDay, start, end };
}

export function eventConflicts(events) {
  const conflicts = new Set();
  const timed = events.filter(event => event.kind === 'event' && event.entry_time);
  for (const [index, event] of timed.entries()) {
    const { start, end } = eventTimes(event);
    for (const other of timed.slice(index + 1)) {
      const times = eventTimes(other);
      if (start < times.end && times.start < end) {
        conflicts.add(event.id);
        conflicts.add(other.id);
      }
    }
  }
  return conflicts;
}

export function ingredientAmount(line, factor = 1) {
  const match = line.match(/^(\d+(?:[.,]\d+)?|\d+\/\d+)\s+(?:(kg|g|mg|l|ml|un|unidades?)\s+)?(.+)$/i);
  if (!match) return { title: line, quantity: null, unit: '' };
  const [, text, rawUnit, title] = match;
  const [first, denominator] = text.replace(',', '.').split('/').map(Number);
  const unit = rawUnit?.toLowerCase().replace(/^unidad(?:es)?$/, 'un') ?? 'un';
  const multiplier = unit === 'kg' || unit === 'l' ? 1000 : 1;
  const quantity = (denominator === undefined ? first : first / denominator) * factor * multiplier;
  if (!Number.isFinite(quantity) || quantity <= 0) return { title: line, quantity: null, unit: '' };
  return { title: title.trim(), quantity, unit: ({ kg: 'g', l: 'ml' })[unit] ?? unit };
}

export function shoppingGroups(records, locale) {
  const groups = new Map();
  for (const item of records) {
    const { quantity, unit } = item.flow ?? {};
    if (item.done || !Number.isFinite(quantity)) continue;
    const key = JSON.stringify([item.category, item.title.toLocaleLowerCase(locale), unit]);
    const group = groups.get(key) ?? { title: item.title, category: item.category, unit, quantity: 0, ids: [] };
    group.quantity += quantity;
    group.ids.push(item.id);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function expenseBalance(records) {
  const byPair = new Map();
  for (const item of records) {
    if (!item.assignee || item.settled) continue;
    for (const [debtor, cents] of Object.entries(item.expense_shares?.shares ?? {})) {
      if (debtor === item.assignee || !cents) continue;
      const pair = [debtor, item.assignee].sort();
      const key = pair.join(':');
      byPair.set(key, (byPair.get(key) ?? 0) + cents * (pair[0] === debtor ? 1 : -1));
    }
  }
  return [...byPair].filter(([, cents]) => cents !== 0).map(([pair, cents]) => {
    const [first, second] = pair.split(':');
    return { debtor: cents > 0 ? first : second, creditor: cents > 0 ? second : first, cents: Math.abs(cents) };
  });
}
