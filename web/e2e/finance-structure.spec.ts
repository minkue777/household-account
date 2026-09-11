import { expect, test } from '@playwright/test';
import { readExpenseDocuments, readFirestoreCollection, resetTestAccount } from './emulator';
import { addExpenseThroughUi, createFinanceHousehold, documentId, findExpense, integerField, openAddTransaction, openExpenseEdit, seoulDate, textField } from './finance-helpers';

test.beforeEach(async () => { await resetTestAccount(); });

test('[SPL-001][LED-008][LED-009] 항목 분할은 합계를 보존하고 다른 카테고리 파생 항목을 만든 뒤 같은 원본 ID로 되돌린다', async ({ page, request }) => {
  await createFinanceHousehold(page, request);
  const original = await addExpenseThroughUi(page, request, { merchant: '분할 장보기', amount: 10001, memo: '원본 메모', category: '생활비' });
  const sourceId = documentId(original);
  await (await openExpenseEdit(page, sourceId)).getByRole('button', { name: '분리', exact: true }).click();
  const split = page.getByRole('heading', { name: '지출 내역 분리', exact: true }).locator('..');
  const firstItem = split.locator('div.p-4.border').nth(0);
  const secondItem = split.locator('div.p-4.border').nth(1);
  await firstItem.locator('input[type="text"]').first().fill('분할 식품');
  await firstItem.locator('input[inputmode="numeric"]').fill('4000');
  await firstItem.getByRole('button', { name: '식비', exact: true }).click();
  await secondItem.locator('input[type="text"]').first().fill('분할 생활');
  await expect(secondItem.locator('input[inputmode="numeric"]')).toHaveValue('6001');
  await split.getByRole('button', { name: '나누기', exact: true }).click();
  let children: Awaited<ReturnType<typeof readExpenseDocuments>> = [];
  await expect.poll(async () => {
    children = (await readExpenseDocuments(request)).filter(doc => textField(doc, 'derivedFromTransactionId') === sourceId && textField(doc, 'lifecycleState') === 'active');
    return children.length;
  }).toBe(2);
  expect(children.map(doc => integerField(doc, 'amount')).sort((a, b) => a - b)).toEqual([4000, 6001]);
  expect(children.map(doc => textField(doc, 'category')).sort()).toEqual(['food', 'living']);
  expect(textField((await findExpense(request, sourceId))!, 'lifecycleState')).toBe('superseded');
  for (const child of children) {
    expect(textField(child, 'creatorMemberId')).toBe(textField(original, 'creatorMemberId'));
    expect(textField(child, 'source')).toBe(textField(original, 'source'));
  }
  await (await openExpenseEdit(page, documentId(children[0]))).getByRole('button', { name: '항목 분할 되돌리기' }).click();
  await expect.poll(async () => (await readExpenseDocuments(request)).filter(doc => textField(doc, 'lifecycleState') === 'active').map(documentId)).toEqual([sourceId]);
  const restored = (await findExpense(request, sourceId))!;
  expect(restored.fields).toMatchObject({ merchant: { stringValue: '분할 장보기' }, memo: { stringValue: '원본 메모' }, amount: { integerValue: '10001' } });
});

test('[SPL-002][SPL-003][SPL-004][SPL-005] 기존 지출 월 분할·개월 변경·취소는 내림 금액과 원본 복원을 보존한다', async ({ page, request }) => {
  await createFinanceHousehold(page, request);
  const original = await addExpenseThroughUi(page, request, { merchant: '월분할 가전', amount: 10001, date: '2026-01-31', memo: '보존 메모' });
  const sourceId = documentId(original);
  let edit = await openExpenseEdit(page, sourceId);
  await edit.getByTitle('월별 분할').click();
  await edit.locator('input[type="number"][min="2"]').fill('3');
  await edit.getByRole('button', { name: '분할 적용' }).click();
  let children: Awaited<ReturnType<typeof readExpenseDocuments>> = [];
  await expect.poll(async () => {
    children = (await readExpenseDocuments(request)).filter(doc => textField(doc, 'splitOriginalId') === sourceId && textField(doc, 'lifecycleState') === 'active');
    return children.length;
  }).toBe(3);
  expect(children.map(doc => textField(doc, 'date')).sort()).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  expect(children.map(doc => integerField(doc, 'amount'))).toEqual([3333, 3333, 3333]);
  expect(new Set(children.map(doc => textField(doc, 'splitGroupId'))).size).toBe(1);
  edit = await openExpenseEdit(page, documentId(children[0]));
  await edit.getByRole('button', { name: '개월 수 변경' }).click();
  await edit.locator('input[type="number"][min="2"]').fill('2');
  await edit.getByRole('button', { name: '변경', exact: true }).click();
  await page.getByRole('dialog', { name: '분할 개월 수 변경' }).getByRole('button', { name: '변경', exact: true }).click();
  await expect.poll(async () => {
    children = (await readExpenseDocuments(request)).filter(doc => textField(doc, 'splitOriginalId') === sourceId && textField(doc, 'lifecycleState') === 'active');
    return children.map(doc => integerField(doc, 'amount'));
  }).toEqual([5000, 5000]);
  edit = await openExpenseEdit(page, documentId(children[0]));
  await edit.getByRole('button', { name: '분할 취소' }).click();
  await expect(edit).toHaveCount(0);
  await expect.poll(async () => textField((await findExpense(request, sourceId))!, 'lifecycleState')).toBe('active');
  expect((await findExpense(request, sourceId))?.fields).toMatchObject({ amount: { integerValue: '10001' }, date: { stringValue: '2026-01-31' }, memo: { stringValue: '보존 메모' } });
});

test('[SPL-006][SPL-005] 신규 월 분할은 메모·수동 카드·생성자를 보존하고 나머지만 버린다', async ({ page, request }) => {
  await createFinanceHousehold(page, request);
  const add = await openAddTransaction(page);
  await add.getByPlaceholder('가맹점명을 입력하세요').fill('신규 할부');
  await add.locator('input[type="number"]').fill('10001');
  await add.locator('input[type="date"]').fill(seoulDate());
  await add.getByPlaceholder('메모를 입력하세요').fill('할부 메모');
  await add.getByTitle('월별 분할').click();
  await add.locator('input[type="number"][min="2"]').fill('3');
  await add.getByRole('button', { name: '추가', exact: true }).click();
  let children: Awaited<ReturnType<typeof readExpenseDocuments>> = [];
  await expect.poll(async () => {
    children = (await readExpenseDocuments(request)).filter(doc => textField(doc, 'lifecycleState') === 'active');
    return children.length;
  }).toBe(3);
  for (const child of children) {
    expect(child.fields).toMatchObject({ amount: { integerValue: '3333' }, memo: { stringValue: '할부 메모' }, cardType: { stringValue: 'manual' } });
    expect(textField(child, 'creatorMemberId')).toBeTruthy();
    expect(textField(child, 'merchant')).toMatch(/신규 할부.*[123].*3/);
  }
});

test('[MRG-001][MRG-002][LED-008][LED-009] 실제 drag로 연속 합치고 되돌리면 세 원본의 ID와 개별 금액·메모가 복원된다', async ({ page, request }) => {
  const householdId = await createFinanceHousehold(page, request);
  const originals = [];
  for (const [merchant, amount, memo] of [['합치기 A', 1100, '첫 메모'], ['합치기 B', 2200, '둘 메모'], ['합치기 C', 3300, '셋 메모']] as const) {
    originals.push(await addExpenseThroughUi(page, request, { merchant, amount, memo, date: seoulDate(0, 1) }));
  }
  await page.goto('/');
  await page.getByTestId(/^calendar-day-/).first().click();
  const item = (merchant: string) => page.getByTestId('expense-item').filter({ hasText: merchant });
  await item('합치기 B').dragTo(item('합치기 A'));
  await expect(item('합치기 A')).toContainText('3,300원');
  await expect(item('합치기 B')).toHaveCount(0);
  // 저장 중에는 UI가 다음 drag를 비활성화합니다. 실제 다시 활성화된 뒤
  // 새 merged ID/version으로 다음 합치기를 실행합니다.
  await expect(item('합치기 A')).toHaveAttribute('draggable', 'true');
  await expect(item('합치기 C')).toHaveAttribute('draggable', 'true');
  await item('합치기 C').dragTo(item('합치기 A'));
  await expect(item('합치기 A')).toContainText('6,600원');
  await expect(page.getByTestId('expense-item')).toHaveCount(1);
  await expect(item('합치기 A')).toHaveAttribute('draggable', 'true');
  // 구조변경은 원본을 canonical 원장에 보존하고 화면용 projection에서 제외합니다.
  const canonical = await readFirestoreCollection(request, `households/${householdId}/ledgerTransactions`);
  for (const original of originals) expect(textField(canonical.find(doc => documentId(doc) === documentId(original))!, 'lifecycleState')).toBe('superseded');
  await item('합치기 A').click();
  await page.getByRole('dialog', { name: '지출 수정' }).getByRole('button', { name: '합치기 되돌리기' }).click();
  await page.getByRole('dialog', { name: '합치기 되돌리기' }).getByRole('button', { name: '진행', exact: true }).click();
  await expect.poll(async () => (await readExpenseDocuments(request)).filter(doc => textField(doc, 'lifecycleState') === 'active').map(documentId).sort()).toEqual(originals.map(documentId).sort());
  for (const original of originals) {
    const restored = (await findExpense(request, documentId(original)))!;
    expect(integerField(restored, 'amount')).toBe(integerField(original, 'amount'));
    expect(textField(restored, 'memo')).toBe(textField(original, 'memo'));
    await expect(item(textField(original, 'merchant')!)).toBeVisible();
  }
});
