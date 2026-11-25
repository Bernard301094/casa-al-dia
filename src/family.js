import { t } from './i18n.js';
export const moduleDetails = () => ({
  recipe:[t('Recetas'),'♨',t('receta'),t('Guarda ingredientes y pasos para cocinar en familia.')],
  contact:[t('Contactos'),'✆',t('contacto'),t('Ten a mano los números y correos importantes.')],
  birthday:[t('Cumpleaños'),'✦',t('cumpleaños'),t('Consulta las próximas celebraciones del hogar.')],
  schedule:[t('Horario'),'◷',t('horario'),t('Organiza los bloques de la semana.')],
  budget:[t('Presupuesto'),'＄',t('presupuesto'),t('Compara el límite del mes con el gasto registrado.')],
  photo:[t('Galería'),'▧',t('archivo'),t('Comparte fotos y videos con tu hogar.')],
  document:[t('Documentos'),'▤',t('documento'),t('Sube y descarga archivos privados de tu hogar.')],
});
export const fileKinds = {
  photo:{bucket:'casa-gallery',accept:'image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime'},
  document:{bucket:'casa-documents',accept:'application/pdf,text/plain,.docx,.xlsx,image/jpeg,image/png,image/webp'},
};
export const monthKey = value => value.slice(0,7);
export function nextBirthday(value, today) {
  const month=Number(value.slice(5,7)), day=Number(value.slice(8,10));
  const year=Number(today.slice(0,4));
  const inYear=y=>{
    const last=new Date(Date.UTC(y,month,0)).getUTCDate();
    return [y,String(month).padStart(2,'0'),String(Math.min(day,last)).padStart(2,'0')].join('-');
  };
  return inYear(year)>=today?inYear(year):inYear(year+1);
}
export function daysUntil(date,today) {
  return (Date.parse(date)-Date.parse(today))/86400000;
}
export function memberLocation() {
  return new Promise((resolve,reject)=>{
    if (!navigator.geolocation) return reject(new Error('Este navegador no admite ubicación.'));
    navigator.geolocation.getCurrentPosition(
      ({coords})=>resolve({latitude:coords.latitude,longitude:coords.longitude}),
      ()=>reject(new Error('No pudimos obtener tu ubicación. Revisa el permiso del navegador.')),
      {enableHighAccuracy:false,timeout:12000,maximumAge:0},
    );
  });
}
