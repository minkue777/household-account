import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  type FirestoreDocument,
  readExpenseDocuments,
  readFirestoreCollection,
} from './emulator';

const CREATED_MERCHANT = 'E2E 원장 카페';
const UPDATED_MERCHANT = 'E2E 수정 카페';
const EXPENSE_AMOUNT = 12_300;

function todayInSeoul(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function documentId(document: FirestoreDocument): string {
  return document.name.slice(document.name.lastIndexOf('/') + 1);
}

async function findExpense(
  request: APIRequestContext,
  id: string
): Promise<FirestoreDocument | undefined> {
  return (await readExpenseDocuments(request))
    .find((document) => documentId(document) === id);
}

test('로그인부터 첫 월 원장과 지출 CRUD까지 실제 Firebase 경계를 통과한다', async ({
  page,
  request,
}) => {
  const today = todayInSeoul();
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto('/');

  await page.getByRole('button', { name: '테스트 계정으로 로그인' }).click();
  await expect(
    page.getByRole('button', { name: '새 가계부 만들기' })
  ).toBeVisible();

  await page.getByRole('button', { name: '새 가계부 만들기' }).click();
  await page.getByLabel('가계부 이름').fill('E2E 테스트');
  await page.getByPlaceholder('내 이름').fill('테스터');
  await page.getByRole('button', { name: '가계부 만들기' }).click();

  const calendar = page.locator('.calendar-glass');
  await expect(calendar).toBeVisible();
  await expect(calendar).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByText('데이터가 없습니다', { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const categories = await readFirestoreCollection(request, 'categories');
    return categories
      .filter((document) => document.fields?.isActive?.booleanValue === true)
      .map((document) => document.fields?.key?.stringValue)
      .sort();
  }).toEqual(['childcare', 'etc', 'fixed', 'food', 'living']);

  await page.getByTestId(`calendar-day-${today}`).click();
  await expect(page.getByText('지출 내역이 없습니다', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '지출 추가' }).click();

  const addDialog = page.getByRole('dialog', { name: '지출 추가' });
  await addDialog.getByPlaceholder('가맹점명을 입력하세요').fill(CREATED_MERCHANT);
  await addDialog.locator('input[type="number"]').fill(String(EXPENSE_AMOUNT));
  await addDialog.getByRole('button', { name: '추가', exact: true }).click();

  const createdItem = page.getByTestId('expense-item').filter({
    hasText: CREATED_MERCHANT,
  });
  await expect(createdItem).toContainText('12,300원');

  let createdDocument: FirestoreDocument | undefined;
  await expect.poll(async () => {
    createdDocument = (await readExpenseDocuments(request)).find(
      (document) =>
        document.fields?.merchant?.stringValue === CREATED_MERCHANT
        && document.fields?.lifecycleState?.stringValue === 'active'
    );
    return createdDocument?.fields;
  }).toMatchObject({
    amount: { integerValue: String(EXPENSE_AMOUNT) },
    aggregateVersion: { integerValue: '1' },
    lifecycleState: { stringValue: 'active' },
  });
  const expenseId = documentId(createdDocument!);

  await createdItem.click();
  const editDialog = page.getByRole('dialog', { name: '지출 수정' });
  const merchantInput = editDialog.locator('input[type="text"]').first();
  await merchantInput.fill(UPDATED_MERCHANT);
  await editDialog.getByRole('button', { name: '저장', exact: true }).click();

  await expect.poll(async () => (await findExpense(request, expenseId))?.fields)
    .toMatchObject({
      merchant: { stringValue: UPDATED_MERCHANT },
      aggregateVersion: { integerValue: '2' },
      lifecycleState: { stringValue: 'active' },
    });
  const updatedItem = page.getByTestId('expense-item').filter({
    hasText: UPDATED_MERCHANT,
  });
  await expect(updatedItem).toBeVisible();

  await updatedItem.click();
  await page
    .getByRole('dialog', { name: '지출 수정' })
    .getByRole('button', { name: '삭제', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: '지출 삭제' })
    .getByRole('button', { name: '삭제', exact: true })
    .click();

  await expect.poll(async () => (await findExpense(request, expenseId))?.fields)
    .toMatchObject({
      aggregateVersion: { integerValue: '3' },
      lifecycleState: { stringValue: 'deleted' },
    });
  await expect(updatedItem).toHaveCount(0);
  await expect(page.getByText('지출 내역이 없습니다', { exact: true })).toBeVisible();
  expect(browserErrors).toEqual([]);
});
