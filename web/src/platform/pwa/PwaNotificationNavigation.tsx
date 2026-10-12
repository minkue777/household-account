'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { expenseNotificationDestination } from './notificationPayload';

/** Route through the existing app; the ledger still resolves access and session scope. */
export function PwaNotificationNavigation() {
  const router = useRouter();
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const receive = (event: MessageEvent) => {
      if (!navigator.serviceWorker.controller || event.source !== navigator.serviceWorker.controller
        || event.data?.type !== 'OPEN_EXPENSE_NOTIFICATION' || !event.ports[0]) return;
      const destination = expenseNotificationDestination(event.data.data, window.location.origin);
      if (!destination) return;
      const url = new URL(destination);
      router.push(url.pathname + url.search, { scroll: false });
      event.ports[0].postMessage({ type: 'EXPENSE_NOTIFICATION_ACCEPTED' });
      event.ports[0].close();
    };
    navigator.serviceWorker.addEventListener('message', receive);
    return () => navigator.serviceWorker.removeEventListener('message', receive);
  }, [router]);
  return null;
}
