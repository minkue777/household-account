import { expect, test } from '@playwright/test';
import { createHouseholdThroughUi, resetTestAccount } from './emulator';

test.beforeEach(resetTestAccount);

test('설정의 다섯 섹션은 다른 화면에서 돌아오면 접히고 저장한 테마는 유지된다', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'ios-webkit') {
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  }
  await createHouseholdThroughUi(page);
  await page.locator('a[href="/settings"]').click();
  const labels = ['카드 등록', '카테고리', '가맹점 규칙', '정기 지출', '테마'];
  const headings = () => labels.map(label => page.getByRole('button', { name: new RegExp(`^${label}`) }).and(page.locator('[aria-expanded]')));
  const openAll = async () => {
    for (const heading of headings()) {
      await expect(heading).toHaveAttribute('aria-expanded', 'false');
      await heading.click();
      await expect(heading).toHaveAttribute('aria-expanded', 'true');
    }
  };
  const expectClosed = async () => {
    for (const heading of headings()) await expect(heading).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: /^선셋 웜/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^테마/ })).toContainText('선셋 웜');
  };
  await openAll();
  await page.getByRole('button', { name: /^선셋 웜/ }).click();
  await page.locator('header a[href="/"]').click();
  await page.locator('a[href="/settings"]').click();
  await expectClosed();

  await openAll();
  await page.goto('/');
  await page.goBack();
  await expectClosed();
  expect(await page.evaluate(() => localStorage.getItem('app-theme'))).toBe('warm');
});
