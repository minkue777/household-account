import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test('[QE-001/QE-003/AND-003/AND-004/ING-SAVE-006/MER-003/CAT-001] Android 수집·Quick Edit 저장 결과를 새 Web 세션에서 그대로 표시한다', async ({ page }) => {
  const fixture = JSON.parse(readFileSync(process.env.NATIVE_E2E_FIXTURE!, 'utf8'));
  const result = JSON.parse(readFileSync(process.env.NATIVE_E2E_RESULT!, 'utf8'));
  expect(result.householdId).toBe(fixture.householdId);
  expect(result.categoryId).toBe(fixture.categoryId);
  // This test never seeds an expense, supplies a transaction response, or resets the shared Emulator.
  await page.goto('/');
  await page.getByRole('button', { name: '테스트 계정으로 로그인' }).click();
  await expect(page.locator('.calendar-glass')).toHaveAttribute('aria-busy', 'false');
  await page.goto(`/expenses/${encodeURIComponent(result.transactionId)}/edit`);
  const dialog = page.getByRole('dialog', { name: '지출 수정', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByPlaceholder('가맹점명을 입력하세요')).toHaveValue(fixture.expectedMerchant);
  await expect(dialog.getByPlaceholder('메모를 입력하세요')).toHaveValue('Android E2E 메모');
  await expect(dialog.locator('input[type="number"]')).toHaveValue(String(fixture.expectedAmountInWon));
  await expect(dialog.getByRole('button', { name: '간식', exact: true })).toHaveClass(/border-blue-500/);
});
