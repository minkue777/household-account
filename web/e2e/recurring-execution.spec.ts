import { test, expect } from '@playwright/test';
import { createHouseholdThroughUi, resetTestAccount } from './emulator';
import { paymentCommand, records } from './payment-helpers';
import { runScheduled } from './portfolio-helpers';
import { joinNotificationHousehold, registerEndpoint, waitForOutbox } from './notifications-helpers';

test.beforeEach(resetTestAccount);

test('[T-REC-PUSH-001][REC-002][REC-003][REC-004][REC-006][SYS-005] 실제 정기 Scheduler는 짧은 달과 누락 월을 보정하고 중복 실행에도 월별 한 건·최초 등록자를 보존한다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  const recipient = await joinNotificationHousehold(request, actor, 'recurring-recipient');
  await registerEndpoint(request, actor, 'recurring-creator-ios', 'ios-pwa');
  await registerEndpoint(request, recipient, 'recurring-recipient-android');
  const created = await paymentCommand(request, actor, 'recurring.create-plan.v1', { plan: {
    merchant: '말일 보험료', amount: 31000, category: 'fixed', dayOfMonth: 31, memo: '예약 자동생성',
  } });
  const plan = (await records(request, `households/${actor.householdId}/recurringPlans`)).find(row => row.planId === created.planId)!;
  const [year, month] = plan.firstApplicableMonth.split('-').map(Number);
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  await runScheduled('recurringDaily', `${firstDay.toISOString().slice(0, 10)}T00:00:00+09:00`);
  expect(await records(request, 'expenses')).toHaveLength(0);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  await runScheduled('recurringDaily', `${lastDay}T00:00:00+09:00`);
  await runScheduled('recurringDaily', `${lastDay}T00:00:00+09:00`);
  const expenses = await records(request, 'expenses');
  expect(expenses).toHaveLength(2);
  expect(expenses.map(row => row.date).sort()).toEqual([
    new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10), lastDay,
  ]);
  for (const row of expenses) expect(row).toMatchObject({ amount: 31000, source: 'recurring', cardType: 'recurring', creatorMemberId: actor.memberId });
  for (const row of expenses) {
    const event = await waitForOutbox(request, row.id, 'TransactionRecorded');
    expect(event.notificationConsumerStatus).toBe('NoTarget');
    expect(event.payload).toMatchObject({ originChannel: 'recurring', creatorMemberId: actor.memberId });
  }
  expect(await records(request, 'e2eFcmTransport')).toHaveLength(0);
  await page.goto('/');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await page.getByPlaceholder('지출처명, 메모, 카드명을 검색해보세요').fill('말일 보험료');
  await expect(page.getByText('2건 · 62,000원', { exact: true })).toBeVisible();
  // 검색 행은 카드 라벨을 표시하지 않습니다. 실제 편집 메타데이터에서 확인합니다.
  const search = page.locator('div.fixed').filter({ has: page.getByPlaceholder('지출처명, 메모, 카드명을 검색해보세요') });
  await search.getByText('말일 보험료', { exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: '지출 수정' })).toContainText('정기지출');
});
