import { randomUUID } from 'node:crypto';
import { test, expect, devices } from '@playwright/test';
import { createHouseholdThroughUi, resetTestAccount, E2E_PROJECT_ID } from './emulator';
import { issueShortcut, paymentCommand, records, registerCard, shortcutMessage, submitShortcut } from './payment-helpers';

test.beforeEach(resetTestAccount);

test('[T-IOS-COMPAT-001][IOS-002] Shortcut 객체 우선 키와 중첩 배열은 실제 HTTP에서 정규화되어 같은 parser·저장 경로로 이어진다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  await registerCard(request, actor);
  const credential = await issueShortcut(request, actor);
  const firstMessage = shortcutMessage({ merchant: '객체 입력 카페', amount: 5100 });
  const first = await submitShortcut(request, credential.rawCredential, { text: firstMessage, value: '무시할 보조 값' });
  expect(first.status).toBe(200);
  expect(first.body).toMatchObject({ contractVersion: 'shortcut-payment-response.v1', transaction: { kind: 'created' }, notification: { state: expect.any(String) } });
  for (const retiredField of ['success', 'duplicate', 'notificationSent', 'targetOwner']) expect(first.body).not.toHaveProperty(retiredField);
  const lines = shortcutMessage({ merchant: '배열 입력 카페', amount: 6200 }).split('\n');
  const second = await submitShortcut(request, credential.rawCredential, [lines.slice(0, 2), null, lines.slice(2)]);
  expect(second.status).toBe(200);
  expect((await records(request, 'expenses')).map(row => [row.merchant, row.amount]).sort()).toEqual([
    ['객체 입력 카페', 5100], ['배열 입력 카페', 6200],
  ]);
  for (const value of [0, true, { unknown: '알 수 없는 객체' }]) {
    const response = await submitShortcut(request, credential.rawCredential, value);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  }
  expect(await records(request, 'expenses')).toHaveLength(2);
});

test('[IOS-001][IOS-003][IOS-004][IOS-006][IOS-007][IOS-009][IOS-011][IOS-014] 실제 발급 credential로 동시 Shortcut 승인을 보내면 한 지출·안전한 진단만 저장하고 재전송도 동일 결과다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  await registerCard(request, actor, '국민', '1234');
  const credential = await issueShortcut(request, actor);
  const message = shortcutMessage();
  const key = `ios-e2e-${randomUUID()}`;
  const [first, concurrent] = await Promise.all([submitShortcut(request, credential.rawCredential, message, key), submitShortcut(request, credential.rawCredential, message, key)]);
  expect(first.status).toBe(200); expect(concurrent.status).toBe(200);
  expect(first.body.contractVersion).toBe('shortcut-payment-response.v1');
  const saved = await records(request, 'expenses');
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ merchant: 'Shortcut 카페', amount: 12300, createdBy: actor.memberId });
  expect(saved[0].cardLastFour).toContain('1234');
  const duplicate = await submitShortcut(request, credential.rawCredential, message);
  expect(duplicate.status).toBe(200);
  expect(duplicate.body.transaction.kind).toBe('duplicate');
  expect(await records(request, 'expenses')).toHaveLength(1);
  const diagnostics = await records(request, 'notification_debug_logs');
  expect(diagnostics.length).toBeGreaterThan(0);
  expect(JSON.stringify(diagnostics)).toContain(message.replaceAll('\n', '\\n'));
  expect(JSON.stringify(diagnostics)).not.toContain(credential.rawCredential);
  expect(JSON.stringify(await records(request, 'outboxEvents'))).not.toContain(message.replaceAll('\n', '\\n'));
  expect(first.headers['cache-control']).toContain('no-store');
});

test('[IOS-001][IOS-010][IOS-012][SYS-007] Shortcut HTTP는 method·content type·credential·스키마를 실제 ingress에서 검증해 거래를 만들지 않는다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  const credential = await issueShortcut(request, actor);
  const url = `http://127.0.0.1:5001/${E2E_PROJECT_ID}/asia-northeast3/addExpenseFromMessage`;
  expect((await request.get(url)).status()).toBe(405);
  expect((await request.fetch(url, { method: 'OPTIONS' })).status()).toBe(204);
  expect((await request.post(url, { data: 'plain body', headers: { 'content-type': 'text/plain' } })).status()).toBe(415);
  expect((await submitShortcut(request, 'invalid-credential', shortcutMessage())).status).toBeGreaterThanOrEqual(400);
  const forged = await request.post(url, { headers: { authorization: `Bearer ${credential.rawCredential}` },
    data: { contractVersion: 'shortcut-payment.v1', message: shortcutMessage(), householdId: 'forged', owner: 'other' } });
  expect(forged.status()).toBeGreaterThanOrEqual(400);
  const unsupported = await submitShortcut(request, credential.rawCredential, '카드사 없는 10,000원 지출');
  expect(unsupported.status).toBeGreaterThanOrEqual(400);
  expect(await records(request, 'expenses')).toHaveLength(0);
});

test.describe('iPhone 설정', () => {
test.use({ userAgent: devices['iPhone 13'].userAgent });
test('[IOS-013] 설정에서 최초 발급한 키는 다시 노출하지 않고 재발급하면 이전 키를 즉시 거절한다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  await registerCard(request, actor);
  await page.goto('/settings');
  await page.getByRole('button', { name: '키 발급 및 설치', exact: true }).click();
  const code = page.locator('code');
  await expect(code).toContainText('Bearer ');
  const first = (await code.innerText()).replace(/^Bearer\s+/, '').trim();
  await expect(page.getByRole('link', { name: '설치 화면 열기' })).toHaveAttribute('href', /^https:\/\//);
  await page.reload();
  await expect(page.getByRole('button', { name: '재발급', exact: true })).toBeVisible();
  await expect(page.locator('code')).toHaveCount(0);
  await page.getByRole('button', { name: '재발급', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '재발급', exact: true }).click();
  await expect(code).toContainText('Bearer ');
  const replacement = (await code.innerText()).replace(/^Bearer\s+/, '').trim();
  expect(replacement).not.toBe(first);
  expect((await submitShortcut(request, first, shortcutMessage())).status).toBeGreaterThanOrEqual(400);
  expect((await submitShortcut(request, replacement, shortcutMessage())).status).toBe(200);
});
});

test('[IOS-003][IOS-015][CAN-003][CAN-007] Shortcut 승인취소는 공통 lineage를 제거하고 후속 다른 금액의 승인은 새 거래로 보존한다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  await registerCard(request, actor);
  const credential = await issueShortcut(request, actor);
  expect((await submitShortcut(request, credential.rawCredential, shortcutMessage({ amount: 140000 }))).status).toBe(200);
  const cancelled = await submitShortcut(request, credential.rawCredential, shortcutMessage({ amount: 140000, cancellation: true }));
  expect(cancelled.status).toBe(200);
  expect(cancelled.body.transaction.kind).toBe('cancelled');
  expect((await submitShortcut(request, credential.rawCredential, shortcutMessage({ amount: 78000 }))).status).toBe(200);
  expect((await records(request, 'expenses')).filter(row => row.lifecycleState === 'active').map(row => row.amount)).toEqual([78000]);
});
