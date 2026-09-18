import { expect, test } from '@playwright/test';
import { resetTestAccount } from './emulator';
import { createFinanceHousehold, documentId, findExpense, openAddTransaction, openExpenseEdit, seoulDate, waitForExpense } from './finance-helpers';

test.beforeEach(async () => { await resetTestAccount(); });

test('[T-LED-011][LED-011][T-SEA-004][SEA-006] 여행 태그를 저장·재사용하고 태그 검색 합계와 삭제가 새로고침 후에도 일치한다', async ({ page, request }, testInfo) => {
  await createFinanceHousehold(page, request);
  await page.setViewportSize({ width: 390, height: 844 });
  let dialog = await openAddTransaction(page);
  await dialog.getByPlaceholder('가맹점명을 입력하세요').fill('부산 숙소');
  await dialog.locator('input[type="number"]').fill('120000');
  await dialog.locator('input[type="date"]').fill(seoulDate());
  await dialog.getByPlaceholder('메모를 입력하세요').fill('2박 숙박');
  await dialog.getByLabel('태그 (선택)', { exact: true }).fill('2026부산여행');
  await dialog.getByRole('button', { name: '태그 추가', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('tags-mobile-add.png'), fullPage: true });
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  const first = await waitForExpense(request, '부산 숙소');
  expect(first.fields?.tags?.arrayValue?.values).toEqual([{ stringValue: '2026부산여행' }]);

  dialog = await openAddTransaction(page);
  await dialog.getByPlaceholder('가맹점명을 입력하세요').fill('부산 식당');
  await dialog.getByPlaceholder('메모를 입력하세요').fill('저녁 식사');
  await dialog.locator('input[type="number"]').fill('28000');
  await dialog.locator('input[type="date"]').fill(seoulDate());
  await dialog.getByRole('button', { name: '#2026부산여행', exact: true }).click();
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  const second = await waitForExpense(request, '부산 식당');
  expect(second.fields?.tags?.arrayValue?.values).toEqual([{ stringValue: '2026부산여행' }]);

  dialog = await openExpenseEdit(page, documentId(first));
  await expect(dialog.getByRole('button', { name: '2026부산여행 태그 제거' })).toBeVisible();
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('tags-mobile-list.png'), fullPage: true });
  await page.getByRole('button', { name: '2026부산여행 태그 검색' }).first().click();
  const search = page.getByPlaceholder('지출처명, 메모, 카드명, 태그 검색');
  await expect(search).toHaveValue('#2026부산여행');
  await expect(page.getByText('2건 · 148,000원', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '지출 수정' })).toHaveCount(0);
  await search.fill('#2026');
  await expect(page.getByText('2건 · 148,000원', { exact: true })).toBeVisible();
  await search.fill('#부산');
  await expect(page.getByText('2건 · 148,000원', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('tags-mobile-search.png'), fullPage: true });

  dialog = await openExpenseEdit(page, documentId(second));
  await dialog.getByRole('button', { name: '2026부산여행 태그 제거' }).click();
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect.poll(async () => (await findExpense(request, documentId(second)))?.fields?.tags?.arrayValue?.values ?? []).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await search.fill('#2026부산여행');
  await expect(page.getByText('1건 · 120,000원', { exact: true })).toBeVisible();
  await search.fill('#2026');
  await expect(page.getByText('1건 · 120,000원', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('tags-desktop-search.png'), fullPage: true });
  await search.fill('부산여행');
  await expect(page.getByText('1건 · 120,000원', { exact: true })).toBeVisible();
});
