// Firebase Messaging Service Worker
importScripts('https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging-compat.js');

// Firebase 설정
firebase.initializeApp({
  apiKey: "AIzaSyCyjcqLX9Gs-yIghFsq9v-vC6K91ZhMuYM",
  authDomain: "household-account-6f300.firebaseapp.com",
  projectId: "household-account-6f300",
  storageBucket: "household-account-6f300.firebasestorage.app",
  messagingSenderId: "530451947649",
  appId: "1:530451947649:web:b5630cc4326eaddbbfad80",
});

const messaging = firebase.messaging();

// 알림 클릭 처리
self.addEventListener('notificationclick', (event) => {

  event.notification.close();

  const rawExpenseId = event.notification.data?.expenseId;
  const expenseId = typeof rawExpenseId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(rawExpenseId)
    ? rawExpenseId
    : null;
  const action = event.action;

  if (action === 'dismiss') {
    return;
  }

  // 수정 화면으로 이동
  const urlToOpen = new URL(
    expenseId ? `/?edit=${encodeURIComponent(expenseId)}` : '/',
    self.location.origin
  ).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 이미 열린 창이 있으면 포커스
      for (const client of clientList) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          client.navigate(urlToOpen);
          return client.focus();
        }
      }
      // 없으면 새 창 열기
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
