import ICAL from 'ical.js';
import { shiftDate } from './planning.js';

export function readCalendar(text) {
  const calendar=new ICAL.Component(ICAL.parse(text));
  const events=[];
  let skipped=0;
  for (const component of calendar.getAllSubcomponents('vevent')) {
    const event=new ICAL.Event(component);
    if (!event.startDate || !event.summary || event.isRecurring() || event.isRecurrenceException()) {
      skipped++;
      continue;
    }
    const start=event.startDate;
    const local=new Date(start.toJSDate());
    const pad=value=>String(value).padStart(2,'0');
    const day=start.isDate ? start.toString() : [local.getFullYear(),pad(local.getMonth()+1),pad(local.getDate())].join('-');
    events.push({kind:'event',title:event.summary.slice(0,160),details:(event.description||'').slice(0,4000),
      entry_date:day,entry_time:start.isDate?null:pad(local.getHours())+':'+pad(local.getMinutes())});
  }
  return {events,skipped};
}

export function writeCalendar(entries) {
  const calendar=new ICAL.Component(['vcalendar',[],[]]);
  calendar.addPropertyWithValue('version','2.0');
  calendar.addPropertyWithValue('prodid','-//Casa al Día//Calendar//ES');
  for (const record of entries) {
    const component=new ICAL.Component('vevent');
    const event=new ICAL.Event(component);
    event.uid=record.id+'@casa-al-dia';
    event.summary=record.title;
    event.description=record.details;
    event.startDate=ICAL.Time.fromString(record.entry_date+(record.entry_time?'T'+record.entry_time.slice(0,5)+':00':''));
    if(record.entry_time) event.duration=ICAL.Duration.fromSeconds((record.flow?.minutes??60)*60);
    else event.endDate=ICAL.Time.fromString(shiftDate(record.entry_date,1));
    if(record.flow?.repeat&&record.flow.until) {
      const until=ICAL.Time.fromString(record.flow.until+(record.entry_time?'T23:59:59':''));
      component.addPropertyWithValue('rrule',new ICAL.Recur({freq:record.flow.repeat.toUpperCase(),until}));
    }
    component.addPropertyWithValue('dtstamp',ICAL.Time.fromJSDate(new Date(),true));
    calendar.addSubcomponent(component);
  }
  return calendar.toString();
}
