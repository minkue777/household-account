import { test, expect } from '@playwright/test';
import { createHouseholdThroughUi, resetTestAccount } from './emulator';
import { addExpenseThroughUi, documentId, expectInsideViewport, openExpenseEdit } from './finance-helpers';

test.beforeEach(resetTestAccount);

test('[LED-001][LED-004] 모바일의 긴 가맹점명은 원장·편집 화면을 가로로 밀지 않고 저장 버튼을 누를 수 있다', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createHouseholdThroughUi(page);
  const merchant = '긴가맹점이름'.repeat(16);
  const row = await addExpenseThroughUi(page, request, { merchant, amount: 12000 });
  const dialog = await openExpenseEdit(page, documentId(row));
  await expect(dialog.locator('input[type="text"]').first()).toHaveValue(merchant);
  await expectInsideViewport(dialog);
  await expectInsideViewport(dialog.getByRole('button', { name: '저장', exact: true }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await dialog.getByPlaceholder('메모를 입력하세요').fill('길어도 저장 가능');
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
