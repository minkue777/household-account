import type { Worker } from '@playwright/test';

type WorkerRuntime = {
  registration: ServiceWorkerRegistration;
  dispatchEvent(event: Event): boolean;
  NotificationEvent: new (type: string, init: { notification: Notification; action: string }) => Event;
};

/** OS notification-click 전달과 이벤트 수명만 대신합니다. 실제 worker handler를
 * 실행합니다. OS의 focus/openWindow 사용자 활성화는 실기기 검증 범위입니다. */
export async function clickNotification(worker: Worker, data: unknown, action = ''): Promise<number> {
  return worker.evaluate(async ({ data, action }) => {
    const runtime = self as unknown as WorkerRuntime;
    await runtime.registration.showNotification('E2E 가계부 알림', { data, tag: 'e2e-notification' });
    const notification = (await runtime.registration.getNotifications({ tag: 'e2e-notification' }))[0];
    const tasks: Promise<unknown>[] = [];
    const event = new runtime.NotificationEvent('notificationclick', { notification, action });
    Object.defineProperty(event, 'waitUntil', { value: (task: Promise<unknown>) => tasks.push(task) });
    runtime.dispatchEvent(event);
    await Promise.all(tasks);
    return tasks.length;
  }, { data, action });
}
