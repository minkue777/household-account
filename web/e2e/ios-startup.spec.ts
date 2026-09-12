import { expect, test } from '@playwright/test';
import { observeIndexedDbOpens, readFirestoreCollection, readIndexedDbOpens, resetTestAccount, writeFirestoreFixture } from './emulator';

const COMPLETE_PAINT = 'household-account:startup:home:first-complete-paint';
test.beforeEach(async () => { await resetTestAccount(); });

test('[T-SYS-008][AND-012][SYS-008] iPhone WebKit 재실행은 로그인 유지와 Firestore IndexedDB 대기 없이 최신 홈을 표시한다', async ({ page: initialPage, context, request }) => {
  let page = initialPage;
  // WebKit의 standalone 감지만 설정합니다. Auth/Firestore SDK와 서버 응답은 실제입니다.
  await observeIndexedDbOpens(page, true);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '테스트 계정으로 로그인' }).click();
  await page.getByRole('button', { name: '새 가계부 만들기' }).click();
  await page.getByLabel('가계부 이름').fill('iOS 시작 테스트');
  await page.getByPlaceholder('내 이름').fill('아이폰 사용자');
  await page.getByRole('button', { name: '가계부 만들기' }).click();
  let calendar = page.locator('.calendar-glass');
  await expect(calendar).toHaveAttribute('aria-busy', 'false');
  const households = await readFirestoreCollection(request, 'households');
  expect(households).toHaveLength(1);
  const householdId = households[0].name.split('/').at(-1)!;
  await writeFirestoreFixture(request, `households/${householdId}/homePreferences/home`, {
    left: { stringValue: 'MONTHLY_EXPENSE' }, right: { stringValue: 'LOCAL_CURRENCY_BALANCE' },
    aggregateVersion: { integerValue: '1' }, selectedLocalCurrencyType: { stringValue: 'gyeonggi' },
  });
  await writeFirestoreFixture(request, `households/${householdId}/localCurrencyBalances/gyeonggi`, {
    localCurrencyType: { stringValue: 'gyeonggi' }, balanceInWon: { integerValue: '25789' },
  });
  let firstDay = page.getByTestId(/^calendar-day-/).first();
  await expect(firstDay).toHaveAttribute('data-testid', /^calendar-day-\d{4}-\d{2}-01$/);
  await firstDay.click();
  await page.getByRole('button', { name: '지출 추가' }).click();
  const dialog = page.getByRole('dialog', { name: '지출 추가' });
  await dialog.getByPlaceholder('가맹점명을 입력하세요').fill('iOS 시작 카페');
  await dialog.locator('input[type="number"]').fill('12300');
  await dialog.getByRole('button', { name: '기타', exact: true }).click();
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  let monthlyCard = page.locator('.balance-card-glass').filter({ hasText: /월 지출/ });
  let currencyCard = page.locator('.balance-card-glass').filter({ hasText: '지역화폐 잔액' });
  await expect(monthlyCard).toContainText('12,300');
  await expect(currencyCard).toContainText('25,789');

  // 열린 stream을 가로채지 않고 실제 재실행을 검사합니다. 앱이 닫힌 동안
  // 서버 잔액을 바꿔 이전 화면의 값이 아니라 최신 결과를 읽는지 확인합니다.
  await page.close();
  await writeFirestoreFixture(request, `households/${householdId}/localCurrencyBalances/gyeonggi`, {
    localCurrencyType: { stringValue: 'gyeonggi' }, balanceInWon: { integerValue: '36890' },
  });
  page = await context.newPage();
  await observeIndexedDbOpens(page, true);
  page.on('pageerror', (error) => errors.push(error.message));
  calendar = page.locator('.calendar-glass');
  firstDay = page.getByTestId(/^calendar-day-/).first();
  monthlyCard = page.locator('.balance-card-glass').filter({ hasText: /월 지출/ });
  currencyCard = page.locator('.balance-card-glass').filter({ hasText: '지역화폐 잔액' });

  await page.goto('/');
  await expect(calendar).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: '테스트 계정으로 로그인' })).toHaveCount(0);
  await expect(monthlyCard).toContainText('12,300');
  await expect(currencyCard).toContainText('36,890');
  await firstDay.click();
  const expenseItem = page.getByTestId('expense-item').filter({ hasText: 'iOS 시작 카페' });
  await expect(expenseItem).toContainText('12,300원');
  await expect(expenseItem.getByText('기타', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate((name) => performance.getEntriesByName(name).length, COMPLETE_PAINT)).toBe(1);
  const databaseNames = await readIndexedDbOpens(page);
  expect(databaseNames.some((name) => name === 'firebaseLocalStorageDb')).toBe(true);
  expect(databaseNames.some((name) => name.startsWith('firestore/'))).toBe(false);
  expect(errors).toEqual([]);
});
