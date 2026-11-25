import { initializeApp } from 'firebase/app';
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { t } from './i18n.js';

const settings = globalThis.CASA_FIREBASE;
const deviceKey = user => 'casa-push-device-'+user;
let messaging;
let unsubscribe;
export const pushConfigured = Boolean(settings?.app && settings.vapidKey);
export const pushEnabled = user => Boolean(localStorage.getItem(deviceKey(user)));

async function client() {
  if (!pushConfigured || !await isSupported()) throw new Error('Este navegador no admite avisos push.');
  messaging ??= getMessaging(initializeApp(settings.app));
  return messaging;
}
export async function enablePush(user, db, announce) {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) throw new Error('Este navegador no admite avisos push.');
  if (await Notification.requestPermission()!=='granted') throw new Error('Activa el permiso de notificaciones en tu navegador.');
  const instance = await client();
  await navigator.serviceWorker.register('sw.js');
  const serviceWorkerRegistration = await navigator.serviceWorker.ready;
  const token = await getToken(instance,{vapidKey:settings.vapidKey,serviceWorkerRegistration});
  if (!token) throw new Error('No se pudo registrar este dispositivo.');
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const {error} = await db.rpc('casa_register_push',{device_token:token,device_timezone:timezone});
  if (error) throw error;
  const previous = localStorage.getItem(deviceKey(user));
  if (previous && previous!==token) await db.rpc('casa_unregister_push',{device_token:previous});
  localStorage.setItem(deviceKey(user),token);
  unsubscribe?.();
  unsubscribe = onMessage(instance,()=>announce(t('Tienes un recordatorio de rutinas.')));
}
export async function disablePush(user, db) {
  const token = localStorage.getItem(deviceKey(user));
  if (!token) return;
  const {error} = await db.rpc('casa_unregister_push',{device_token:token});
  if (error) throw error;
  localStorage.removeItem(deviceKey(user));
  unsubscribe?.();
  unsubscribe=undefined;
  if (pushConfigured && await isSupported()) await deleteToken(await client()).catch(()=>{});
}
export async function listenForPush(user, announce) {
  unsubscribe?.();
  unsubscribe=undefined;
  if (!pushConfigured || !pushEnabled(user) || !await isSupported()) return;
  unsubscribe=onMessage(await client(),()=>announce(t('Tienes un recordatorio de rutinas.')));
}
