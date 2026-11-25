# Casa al Día

Organizador familiar. Interfaz en español, gastos en BRL y fechas locales del dispositivo.

## Desarrollo

1. Instala Node.js y ejecuta `npm ci`.
2. Ajusta `src/config.js` con la URL del proyecto y su clave **publishable**. El repositorio usa el proyecto Casa al Día. Para un proyecto distinto, aplica primero la migración en `supabase/migrations`.
3. Ejecuta `npm run build` y sirve el contenido de `dist`. Para desarrollo puedes usar `python3 -m http.server 5173 --directory dist`.
4. En Supabase Authentication → URL Configuration, configura como Site URL el origen de producción y agrega los orígenes de desarrollo o alternativos a Redirect URLs. Las confirmaciones y recuperaciones usan esa configuración. Para enviar correos de Auth a personas ajenas al equipo del proyecto, configura un SMTP propio.
5. Para uso familiar, aloja `dist` en una URL HTTPS que todos los invitados puedan abrir. Una vista privada de Sites solo sirve para revisión del propietario. Las políticas de Supabase conservan la privacidad de los registros incluso si el alojamiento es accesible por enlace.

El invitado debe iniciar sesión, abrir su enlace y completar el formulario de acceso al hogar. Los códigos caducan en siete días y se consumen una sola vez. Los registros archivados quedan guardados en la base y se excluyen de las vistas. La app requiere conexión para consultar y guardar datos.

## Google

En Google Cloud, registra un cliente OAuth de tipo aplicación web. Configura el origen HTTPS de la app y la URL de retorno de Supabase, `https://cuocktwxrkewwcmkrlbw.supabase.co/auth/v1/callback` para el proyecto actual. En Authentication → Sign In / Providers → Google, habilita el proveedor y guarda el ID y el secreto directamente en Supabase. En modo de prueba, agrega las cuentas autorizadas en Google Cloud.

## Módulos familiares

Explorar reúne listas, calendario, recetas, mensajes, galería, contactos, actividad, cumpleaños, documentos, presupuesto, comidas, horario y mapa. Las listas se agrupan por nombre. Los presupuestos se suman por mes y comparan con los gastos registrados en ese mes. Los archivos de hasta 20 MB se guardan en buckets privados y se abren por enlaces de corta duración. El mapa muestra ubicaciones compartidas manualmente durante 24 horas. Los miembros pueden retirar su ubicación antes de ese plazo.

## Rutinas y recordatorios

En **Explorar → Rutinas**, crea una repetición diaria o semanal. Puedes escoger un responsable principal y otro alterno. Desde el selector de fecha puedes completar, omitir o reasignar esa fecha. Hoy muestra las rutinas pendientes de la fecha local del dispositivo. Si programas un aviso, se muestra dentro de la app mientras está abierta. Los avisos push con la app cerrada requieren la integración de Firebase Cloud Messaging.

## Recordatorios push para rutinas

La configuración pública de Firebase vive en `dist/firebase-config.js`. La app registra los dispositivos desde **Mi familia → Avisos push** y permite revocarlos. Firebase muestra un aviso genérico para mantener los detalles familiares fuera de la pantalla bloqueada. Supabase selecciona los turnos pendientes según el responsable, las excepciones y la zona horaria registrada por el dispositivo.

Para habilitar el envío, guarda en los secretos de Edge Functions el JSON de una cuenta de servicio con permiso para enviar mensajes al proyecto Firebase bajo `FCM_SERVICE_ACCOUNT_JSON`. Crea un valor aleatorio de alta entropía para `ROUTINE_PUSH_SECRET` y guarda el mismo valor en Vault como `routine_push_secret`. Guarda también la URL base del proyecto Supabase en Vault con el nombre `routine_push_project_url`. El programador puede ejecutar `supabase/schedule-routine-push.sql` cuando esos valores estén disponibles. El SQL no contiene credenciales.
