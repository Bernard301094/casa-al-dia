import { initializeApp } from 'firebase/app';
import { getMessaging } from 'firebase/messaging/sw';

importScripts('firebase-config.js');
const settings = globalThis.CASA_FIREBASE;
if (settings?.app && settings.vapidKey) getMessaging(initializeApp(settings.app));
