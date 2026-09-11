import { expect, test } from '@playwright/test';
import { createEmulatorAccount, executeHouseholdCommand, observeIndexedDbOpens, resetTestAccount } from './emulator';
import { addExpenseThroughUi, createFinanceHousehold, documentId, seoulDate } from './finance-helpers';

test.beforeEach(async ({ page, browserName }) => {
  await resetTestAccount();
  if (browserName === 'webkit') await observeIndexedDbOpens(page, true);
});

test('[PUSH-006][PUSH-011][LED-001] 과거월 지출 편집 링크에 도착하면 로그인 복원 후 해당 월과 실제 수정 화면을 연다', async ({ page, request }) => {
  await createFinanceHousehold(page, request);
  const expense = await addExpenseThroughUi(page, request, { merchant: '과거 알림 거래', amount: 4567, date: seoulDate(-4), memo: '링크 도착 원문' });
  await page.goto(`/expenses/${encodeURIComponent(documentId(expense))}/edit`);
  const edit = page.getByRole('dialog', { name: '지출 수정', exact: true });
  await expect(edit).toBeVisible();
  await expect(edit.locator('input[type="text"]').first()).toHaveValue('과거 알림 거래');
  await expect(edit.locator('input[type="date"]')).toHaveValue(seoulDate(-4));
  await expect(edit.getByPlaceholder('메모를 입력하세요')).toHaveValue('링크 도착 원문');
  await expect(page.getByPlaceholder('지출처명, 메모, 카드명을 검색해보세요')).toHaveCount(0);
  await edit.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByTestId(`calendar-day-${seoulDate(-4)}`)).toBeVisible();
  await expect(page.getByTestId('expense-item').filter({ hasText: '과거 알림 거래' })).toContainText('4,567원');
});

test('[PUSH-011][HH-008] 없는 ID와 다른 가구의 편집 링크는 정보를 노출하지 않고 오류를 표시한다', async ({ page, request }) => {
  await createFinanceHousehold(page, request);
  await page.goto('/expenses/does-not-exist-e2e/edit');
  await expect(page.locator('p[role="alert"]')).toContainText(/지출을 (찾을 수 없습니다|불러오지 못했습니다)/);
  await expect(page.getByRole('dialog', { name: '지출 수정' })).toHaveCount(0);
  await expect(page.getByPlaceholder('지출처명, 메모, 카드명을 검색해보세요')).toHaveCount(0);
  const outsider = await createEmulatorAccount(request, 'deeplink-outsider@household.test');
  const household = await executeHouseholdCommand<{ householdId: string }>(request, { idToken: outsider.idToken, command: 'access.create-household-with-self.v1', payload: { householdName: '다른 링크 가구', memberName: '다른 사용자' } });
  const expense = await executeHouseholdCommand<{ transactionId: string }>(request, { idToken: outsider.idToken, householdId: household.householdId, command: 'ledger.record-manual-transaction.v1', payload: { transactionType: 'expense', merchant: '읽으면 안 되는 거래', amountInWon: 7654, categoryId: 'etc', accountingDate: seoulDate() } });
  await page.goto(`/expenses/${encodeURIComponent(expense.transactionId)}/edit`);
  await expect(page.locator('p[role="alert"]')).toContainText('지출을 불러오지 못했습니다.');
  await expect(page.getByRole('dialog', { name: '지출 수정' })).toHaveCount(0);
  await expect(page.getByText('읽으면 안 되는 거래', { exact: true })).toHaveCount(0);
});
