import { expect, test, type Page, type Worker } from '@playwright/test';

type WorkerRuntime = { registration: ServiceWorkerRegistration; dispatchEvent(event: Event): boolean; NotificationEvent: new (type: string, init: { notification: Notification; action: string }) => Event };

async function registeredWorker(page: Page): Promise<Worker> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /\uB85C\uADF8\uC778/ }).first()).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByRole('button', { name: /로그인/ }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('/sw.js');
  return page.context().serviceWorkers().find(worker => new URL(worker.url()).pathname === '/sw.js')!;
}

/** OS notification-click 전달과 이벤트 수명만 대신합니다. 실제 worker handler를
 * 실행하며, 합성 이벤트에는 OS 사용자 활성화가 없어 navigate 뒤 focus가 거절될 수 있습니다. */
async function clickNotification(worker: Worker, data: unknown, action = ''): Promise<number> {
  return worker.evaluate(async ({ data, action }) => {
    const runtime = self as unknown as WorkerRuntime;
    await runtime.registration.showNotification('E2E 가계부 알림', { data, tag: 'e2e-notification' });
    const notification = (await runtime.registration.getNotifications({ tag: 'e2e-notification' }))[0];
    const tasks: Promise<unknown>[] = [];
    const event = new runtime.NotificationEvent('notificationclick', { notification, action });
    Object.defineProperty(event, 'waitUntil', { value: (task: Promise<unknown>) => tasks.push(task) });
    runtime.dispatchEvent(event);
    const results = await Promise.allSettled(tasks);
    let rejectedFocus = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') continue;
      if (result.reason instanceof DOMException && result.reason.name === 'InvalidAccessError' && result.reason.message === 'Not allowed to focus a window.') {
        rejectedFocus += 1;
      } else {
        throw result.reason;
      }
    }
    return rejectedFocus;
  }, { data, action });
}

test('[T-PWA-004][T-PUSH-SEC-002][PWA-003][PWA-005][PWA-006] 생성된 실제 worker 클릭 handler는 정상 ID를 인코딩하여 기존 창을 열고 공격·dismiss를 무시한다', async ({ page, context }) => {
  const worker = await registeredWorker(page);
  await context.grantPermissions(['notifications'], { origin: new URL(page.url()).origin });
  expect(await page.evaluate(() => Notification.permission)).toBe('granted');
  const valid = (expenseId: string) => ({ payloadVersion: 'notification-payload.v1', type: 'household-notification-requested', clickTarget: 'expense-edit', expenseId });
  for (const id of ['실제 worker/거래?수정#1&edit=other', 'safe-expense-id']) {
    const rejectedFocus = await clickNotification(worker, { FCM_MSG: { data: valid(id) } });
    expect(rejectedFocus).toBeLessThanOrEqual(1);
    if (rejectedFocus) test.info().annotations.push({ type: 'OS boundary', description: '실제 navigate 이후 focus는 합성 알림 이벤트의 사용자 활성화 부재로 거절됨. OS focus/openWindow는 실기기 검증 범위입니다.' });
    await expect.poll(() => new URL(page.url()).searchParams.get('edit')).toBe(id);
    await expect(page.getByRole('button', { name: /\uB85C\uADF8\uC778/ }).first()).toBeVisible();
    expect(context.pages()).toHaveLength(1);
  }
  const before = page.url();
  for (const payload of [valid('..'), valid('%2e%2e'), valid('%252e%252e'), valid('\\evil'), valid('bad\u0000id'), { ...valid('valid'), clickTarget: 'https://evil.example' }, { url: 'https://evil.example', expenseId: 'valid' }]) {
    expect(await clickNotification(worker, payload)).toBe(0);
    expect(page.url()).toBe(before);
    expect(context.pages()).toHaveLength(1);
  }
  expect(await clickNotification(worker, valid('dismissed-expense'), 'dismiss')).toBe(0);
  expect(page.url()).toBe(before);
  expect(await worker.evaluate(async () => (await (self as unknown as WorkerRuntime).registration.getNotifications()).length)).toBe(0);
});

test('[T-PWA-002][PWA-004][PWA-007] production worker는 식별자 URL·인증 header·API·HTML을 Cache Storage에 남기지 않는다', async ({ page, context }) => {
  await registeredWorker(page);
  const retiredApiStatus = await page.evaluate(async () => {
    await fetch('/icons/icon-192x192.png?householdId=e2e-private');
    await fetch('/icons/icon-512x512.png', { headers: { authorization: 'Bearer synthetic-test-credential' } });
    // 현재 Web 내부 API는 이 폐기된 POST 경로뿐이며 실제 응답은 410입니다.
    // 정상 GET/API 분류는 운영 urlPattern을 실행하는 pwaRuntimeCache 단위가
    // 검증합니다. 이 E2E는 존재하지 않는 정상 API 응답을 만들어 주지 않습니다.
    const retired = await fetch('/api/dividend/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    await fetch('/?edit=private-expense');
    return retired.status;
  });
  expect(retiredApiStatus).toBe(410);
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(request => ({ url: request.url, authorization: request.headers.get('authorization') }))))).flat());
  expect(cached.filter(entry => {
    const url = new URL(entry.url);
    const privateQuery = Array.from(url.searchParams.keys()).some(key => key !== '__WB_REVISION__');
    return privateQuery || entry.authorization || url.pathname.startsWith('/api/');
  })).toEqual([]);
  // HTML은 cache에서 오프라인 fallback을 제공하지 않습니다.
  await context.setOffline(true);
  await expect(page.goto('/?edit=private-expense', { waitUntil: 'domcontentloaded' })).rejects.toThrow();
  await context.setOffline(false);
});

test('[PWA-003][PWA-005][PWA-006] 실제 생성 worker의 Messaging SDK는 data-only push를 한 번 표시하고 잘못된 payload를 거절한다', async ({ page, context }) => {
  const worker = await registeredWorker(page);
  await context.grantPermissions(['notifications'], { origin: new URL(page.url()).origin });
  expect(await page.evaluate(() => Notification.permission)).toBe('granted');
  const origin = new URL(page.url()).origin;
  const session = await context.newCDPSession(page);
  let registrationId: string | undefined;
  session.on('ServiceWorker.workerRegistrationUpdated', event => {
    registrationId = event.registrations.find(registration => registration.scopeURL === `${origin}/` && !registration.isDeleted)?.registrationId ?? registrationId;
  });
  await session.send('ServiceWorker.enable');
  await expect.poll(() => registrationId).toBeTruthy();
  await page.goto('about:blank');
  const push = async (data: unknown) => session.send('ServiceWorker.deliverPushMessage', {
    origin, registrationId: registrationId!, data: JSON.stringify(data),
  });
  // Push 전달만 Chromium DevTools로 주입합니다. PushEvent와 SDK background handler는 브라우저가 실행합니다.
  await push({ from: 'e2e-sender', data: { url: 'https://evil.example', expenseId: '..' } });
  await push({ from: 'e2e-sender', data: { payloadVersion: 'notification-payload.v1', type: 'expense-created', clickTarget: 'expense-edit', expenseId: 'real-push-expense' } });
  await expect.poll(() => worker.evaluate(async () => (await (self as unknown as WorkerRuntime).registration.getNotifications()).map(notification => ({ title: notification.title, expenseId: notification.data.expenseId }))))
    .toEqual([{ title: '가계부 알림', expenseId: 'real-push-expense' }]);
  await worker.evaluate(async () => {
    const registration = (self as unknown as WorkerRuntime).registration;
    const notifications = await registration.getNotifications();
    if (notifications.length !== 1) throw new Error(`Unexpected notification count: ${notifications.length}`);
    notifications.forEach(notification => notification.close());
  });
  await session.detach();
});
