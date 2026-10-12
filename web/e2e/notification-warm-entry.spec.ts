import { clickNotification } from '../e2e-pwa/notification-click';
import { expect, test } from '@playwright/test';
import { resetTestAccount } from './emulator';
import { addExpenseThroughUi, createFinanceHousehold, documentId, seoulDate } from './finance-helpers';

test.use({ channel: 'chromium' });
test.beforeEach(async () => { await resetTestAccount(); });

test('[PWA-006][T-PWA-004][PUSH-011] 실제 worker의 MessageChannel로 다른 화면에서 지출을 열어도 문서와 인증을 재시작하지 않는다', async ({ page, context, request }) => {
  await createFinanceHousehold(page, request);
  const expense = await addExpenseThroughUi(page, request, { merchant: '알림 재사용 거래', amount: 4567, date: seoulDate(-4), memo: '기존 문서 유지' });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL), { timeout: 35_000 }).toContain('/sw.js');
  await page.getByRole('link', { name: '설정', exact: true }).click();
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible();
  const before = await page.evaluate(() => performance.timeOrigin);
  const navigations: string[] = [], authRequests: string[] = [];
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(request.url());
    if (/signInWithCustomToken|securetoken/.test(request.url())) authRequests.push(request.url());
  });
  const worker = context.serviceWorkers().find(worker => new URL(worker.url()).pathname === '/sw.js');
  expect(worker).toBeDefined();
  await context.grantPermissions(['notifications'], { origin: new URL(page.url()).origin });
  expect(await page.evaluate(() => Notification.permission)).toBe('granted');
  await clickNotification(worker!, { payloadVersion: 'notification-payload.v1', type: 'household-notification-requested',
    clickTarget: 'expense-edit', expenseId: documentId(expense) });
  const edit = page.getByRole('dialog', { name: '지출 수정', exact: true });
  await expect(edit).toBeVisible();
  await expect(edit.locator('input[type="text"]').first()).toHaveValue('알림 재사용 거래');
  await expect(edit.getByPlaceholder('메모를 입력하세요')).toHaveValue('기존 문서 유지');
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(before);
  expect(navigations).toEqual([]);
  expect(authRequests).toEqual([]);
});
