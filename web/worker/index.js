import { initializeApp } from 'firebase/app';
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw';
import { firebaseConfig } from '../src/platform/firebase/firebasePublicConfig';
import { expenseNotificationData, expenseNotificationDestination } from '../src/platform/pwa/notificationPayload';

const workerVersion = process.env.NEXT_PUBLIC_PWA_WORKER_VERSION;
const cacheVersion = `static-v1-${workerVersion}`;

// Install our validation/click handlers before Firebase attaches its handlers.
self.addEventListener('push', event => {
  let payload;
  try { payload = event.data?.json(); } catch { /* Reject malformed push data. */ }
  if (!expenseNotificationData(payload?.data)) event.stopImmediatePropagation();
});

self.addEventListener('notificationclick', event => {
  event.stopImmediatePropagation();
  event.notification.close();
  if (event.action === 'dismiss') return;
  const data = event.notification.data?.FCM_MSG?.data ?? event.notification.data;
  const destination = expenseNotificationDestination(data, self.location.origin);
  if (!destination) return;
  event.waitUntil((async () => {
    for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(destination);
        return client.focus();
      }
    }
    return self.clients.openWindow(destination);
  })());
});

self.addEventListener('message', event => {
  // Workbox's unversioned compatibility message must not bypass our handshake.
  if (event.data?.type === 'SKIP_WAITING') event.stopImmediatePropagation();
  if (event.data?.type === 'GET_WORKER_VERSION') {
    event.ports?.[0]?.postMessage({ type: 'UPDATE_AVAILABLE', workerVersion, cacheVersion });
  }
  if (event.data?.type === 'ACTIVATE_WAITING_WORKER' && event.data.workerVersion === workerVersion) {
    event.waitUntil(self.skipWaiting());
  }
});

const messaging = getMessaging(initializeApp(firebaseConfig));
onBackgroundMessage(messaging, payload => {
  const data = expenseNotificationData(payload.data);
  // Firebase already displays valid notification messages; display data-only messages once.
  if (!data || payload.notification) return;
  return self.registration.showNotification('가계부 알림', {
    body: '새 지출 내역을 확인해 주세요.', icon: '/icons/icon-192x192.png', data,
  });
});
