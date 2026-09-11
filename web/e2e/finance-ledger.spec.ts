import { expect, test } from '@playwright/test';
import { executeHouseholdCommand, readExpenseDocuments, readFirestoreCollection, resetTestAccount, signInTestAccount } from './emulator';
import { addCategoryThroughUi, addExpenseThroughUi, createFinanceHousehold, documentId, findExpense, integerField, openAddTransaction, openExpenseEdit, seoulDate, textField } from './finance-helpers';

test.beforeEach(async () => { await resetTestAccount(); });

test('[LED-002][LED-004][LED-005][CAT-002] 사용자 카테고리로 등록하고 메모만 수정해도 정확한 ID·카드 표시·금액이 보존된다', async ({ page, request }) => {
  await createFinanceHousehold(page, request);
  const category = await addCategoryThroughUi(page, request, '간식/디저트/커피');
  const key = textField(category, 'key');
  expect(key).toBeTruthy();
  const expense = await addExpenseThroughUi(page, request, { merchant: '회귀 카페', amount: 7300, category: '간식/디저트/커피' });
  const id = documentId(expense);
  expect(expense.fields).toMatchObject({ category: { stringValue: key }, cardType: { stringValue: 'manual' }, cardDisplay: { stringValue: '수동' }, amount: { integerValue: '7300' } });
  expect(textField(expense, 'time')).toMatch(/^\d{2}:\d{2}$/);

  let dialog = await openExpenseEdit(page, id);
  await expect(dialog).toContainText('수동');
  await expect(dialog.getByRole('button', { name: '간식', exact: true })).toHaveClass(/border-blue-500/);
  await dialog.getByPlaceholder('메모를 입력하세요').fill('메모만 추가');
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect.poll(async () => (await findExpense(request, id))?.fields).toMatchObject({
    memo: { stringValue: '메모만 추가' }, category: { stringValue: key }, amount: { integerValue: '7300' }, aggregateVersion: { integerValue: '2' },
  });
  dialog = await openExpenseEdit(page, id);
  await expect(dialog.getByRole('button', { name: '간식', exact: true })).toHaveClass(/border-blue-500/);
  await expect(dialog.getByPlaceholder('메모를 입력하세요')).toHaveValue('메모만 추가');
  await dialog.getByRole('button', { name: '식비', exact: true }).click();
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect.poll(async () => (await findExpense(request, id))?.fields).toMatchObject({ category: { stringValue: 'food' }, memo: { stringValue: '메모만 추가' }, amount: { integerValue: '7300' } });
});

test('[LED-002][LED-005] 필수 입력을 검증하고 금액·가맹점·날짜 수정과 논리 삭제가 검색·월 합계에 수렴한다', async ({ page, request }) => {
  await createFinanceHousehold(page, request);
  const add = await openAddTransaction(page);
  await expect(add.getByRole('button', { name: '추가', exact: true })).toBeDisabled();
  await add.getByPlaceholder('가맹점명을 입력하세요').fill('   ');
  await add.locator('input[type="number"]').fill('100');
  await expect(add.getByRole('button', { name: '추가', exact: true })).toBeDisabled();
  await add.getByPlaceholder('가맹점명을 입력하세요').fill('필수 입력 검증');
  await add.locator('input[type="number"]').fill('0');
  await expect(add.getByRole('button', { name: '추가', exact: true })).toBeDisabled();
  await add.getByRole('button', { name: '취소', exact: true }).click();
  expect(await readExpenseDocuments(request)).toHaveLength(0);
  const original = await addExpenseThroughUi(page, request, { merchant: '변경 전', amount: 5000 });
  const id = documentId(original);
  let edit = await openExpenseEdit(page, id);
  await edit.locator('input[type="text"]').first().fill('변경 후');
  await edit.locator('input[type="number"]').fill('8100');
  await edit.locator('input[type="date"]').fill(seoulDate(-1));
  await edit.getByRole('button', { name: '저장', exact: true }).click();
  await expect.poll(async () => (await findExpense(request, id))?.fields).toMatchObject({ merchant: { stringValue: '변경 후' }, amount: { integerValue: '8100' }, date: { stringValue: seoulDate(-1) } });
  edit = await openExpenseEdit(page, id);
  await edit.getByRole('button', { name: '삭제', exact: true }).click();
  await page.getByRole('dialog', { name: '지출 삭제' }).getByRole('button', { name: '삭제', exact: true }).click();
  await expect.poll(async () => (await findExpense(request, id))?.fields).toMatchObject({ lifecycleState: { stringValue: 'deleted' }, merchant: { stringValue: '변경 후' }, amount: { integerValue: '8100' } });
  await page.goto('/');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await page.getByPlaceholder('지출처명, 메모, 카드명을 검색해보세요').fill('변경 후');
  await expect(page.getByText('"변경 후"에 대한 검색 결과가 없습니다.', { exact: true })).toBeVisible();
  await page.goto('/stats');
  await expect(page.getByText('데이터 없음', { exact: true })).toBeVisible();
});

test('[LED-003][LED-005][LED-006][LED-007] 수입 항목 CRUD는 지출과 분리되고 수입 화면에는 알림 요청이 없다', async ({ page, request }) => {
  await createFinanceHousehold(page, request);
  const add = await openAddTransaction(page, 'income');
  await add.locator('input[type="number"]').fill('2500000');
  await expect(add.getByRole('button', { name: '추가', exact: true })).toBeDisabled();
  await add.getByPlaceholder('항목을 입력하세요').fill('9월 급여');
  await add.getByRole('button', { name: '추가', exact: true }).click();
  let incomeId = '';
  await expect.poll(async () => {
    const income = (await readExpenseDocuments(request)).find(doc => textField(doc, 'transactionType') === 'income');
    incomeId = income ? documentId(income) : '';
    return income?.fields;
  }).toMatchObject({ merchant: { stringValue: '수입' }, category: { stringValue: 'etc' }, memo: { stringValue: '9월 급여' }, amount: { integerValue: '2500000' } });
  const item = page.getByTestId('expense-item').filter({ hasText: '9월 급여' });
  await expect(item).toContainText('2,500,000원');
  await item.click();
  const edit = page.getByRole('dialog', { name: '수입 수정' });
  await expect(edit.getByRole('button', { name: '알림 보내기' })).toHaveCount(0);
  await edit.getByPlaceholder('항목을 입력하세요').fill('수정된 급여');
  await edit.locator('input[type="number"]').fill('2600000');
  await edit.getByRole('button', { name: '저장', exact: true }).click();
  await expect.poll(async () => (await findExpense(request, incomeId))?.fields).toMatchObject({ memo: { stringValue: '수정된 급여' }, amount: { integerValue: '2600000' } });
  await expect(page.locator('.balance-card-glass').filter({ hasText: /월 수입/ })).toContainText('2,600,000');
  await page.goto('/');
  await expect(page.locator('.calendar-glass')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByText('수정된 급여', { exact: true })).toHaveCount(0);
  await page.goto('/income');
  await page.getByTestId(/^calendar-day-/).first().click();
  await page.getByTestId('expense-item').filter({ hasText: '수정된 급여' }).click();
  await page.getByRole('dialog', { name: '수입 수정' }).getByRole('button', { name: '삭제', exact: true }).click();
  await page.getByRole('dialog', { name: '수입 삭제' }).getByRole('button', { name: '삭제', exact: true }).click();
  await expect.poll(async () => textField((await findExpense(request, incomeId))!, 'lifecycleState')).toBe('deleted');
});

test('[LED-007] 수정 화면의 알림 보내기는 인증된 요청자와 서버 요청 메타데이터를 저장한다', async ({ page, request }) => {
  const householdId = await createFinanceHousehold(page, request);
  const expense = await addExpenseThroughUi(page, request, { merchant: '알림 요청 카페', amount: 2200 });
  const edit = await openExpenseEdit(page, documentId(expense));
  await edit.getByRole('button', { name: '알림 보내기' }).click();
  await expect.poll(async () => {
    const outbox = await readFirestoreCollection(request, 'outboxEvents');
    return outbox.filter(doc => textField(doc, 'aggregateId') === documentId(expense)).map(doc => textField(doc, 'eventType'));
  }).toContain('HouseholdNotificationRequested');
  const stored = (await findExpense(request, documentId(expense)))!;
  expect(integerField(stored, 'aggregateVersion')).toBeGreaterThan(1);
  expect(textField(stored, 'householdId')).toBe(householdId);
  expect(stored.fields?.notificationRequest?.mapValue?.fields?.requesterMemberId?.stringValue).toBe(textField(expense, 'creatorMemberId'));
  expect(stored.fields?.notificationRequest?.mapValue?.fields?.requestedAt?.stringValue).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test('[LED-005][LED-008] 오래된 version 수정·삭제는 실제 Command에서 거부되고 성공한 변경을 덮어쓰지 않는다', async ({ page, request }) => {
  const householdId = await createFinanceHousehold(page, request);
  const account = await signInTestAccount(request);
  const expense = await addExpenseThroughUi(page, request, { merchant: '버전 충돌 거래', amount: 4000 });
  const transactionId = documentId(expense);
  await executeHouseholdCommand(request, { idToken: account.idToken, householdId, command: 'ledger.update-transaction.v1', payload: { transactionId, expectedVersion: 1, patch: { memo: '성공한 수정' } } });
  await expect(executeHouseholdCommand(request, { idToken: account.idToken, householdId, command: 'ledger.update-transaction.v1', payload: { transactionId, expectedVersion: 1, patch: { amountInWon: 99000 } } })).rejects.toThrow(/VERSION_MISMATCH/);
  await expect(executeHouseholdCommand(request, { idToken: account.idToken, householdId, command: 'ledger.delete-transaction.v1', payload: { transactionId, expectedVersion: 1 } })).rejects.toThrow(/VERSION_MISMATCH/);
  const dialog = await openExpenseEdit(page, transactionId);
  await expect(dialog.getByPlaceholder('메모를 입력하세요')).toHaveValue('성공한 수정');
  await expect(dialog.locator('input[type="number"]')).toHaveValue('4000');
  expect((await findExpense(request, transactionId))?.fields).toMatchObject({ aggregateVersion: { integerValue: '2' }, lifecycleState: { stringValue: 'active' } });
});

test('[T-LED-001][LED-001][HH-005] 같은 월의 지출·수입·설정 이동은 월 원장의 준비 상태를 다시 로딩으로 되돌리지 않는다', async ({ page, request }) => {
  await createFinanceHousehold(page, request);
  await addExpenseThroughUi(page, request, { merchant: '유지되는 월 원장', amount: 5000 });
  await page.goto('/');
  await expect(page.locator('.calendar-glass')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => {
    const observation = { unreadyFrames: 0, observer: undefined as MutationObserver | undefined };
    observation.observer = new MutationObserver(() => {
      if (document.querySelector('.calendar-glass[aria-busy="true"]')) observation.unreadyFrames += 1;
    });
    observation.observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy'] });
    (window as unknown as { financeReadiness: typeof observation }).financeReadiness = observation;
  });
  await page.locator('a[href="/income"]').click();
  await expect(page.locator('.calendar-glass')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.balance-card-glass').filter({ hasText: /월 수입/ })).toContainText('0');
  await page.locator('a[href="/"]').click();
  await expect(page.locator('.balance-card-glass').filter({ hasText: /월 지출/ })).toContainText('5,000');
  await page.locator('a[href="/settings"]').click();
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible();
  await page.locator('a[href="/"]').click();
  await expect(page.locator('.balance-card-glass').filter({ hasText: /월 지출/ })).toContainText('5,000');
  const unreadyFrames = await page.evaluate(() => {
    const observation = (window as unknown as { financeReadiness: { unreadyFrames: number; observer: MutationObserver } }).financeReadiness;
    observation.observer.disconnect();
    return observation.unreadyFrames;
  });
  expect(unreadyFrames).toBe(0);
});
