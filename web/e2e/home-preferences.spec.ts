import { expect, test } from '@playwright/test';
import { createHouseholdThroughUi, executeHouseholdCommand, resetTestAccount } from './emulator';
import { documents } from './portfolio-helpers';

test.beforeEach(async () => { await resetTestAccount(); });

test('[T-HOME-002][T-HOME-003][HOME-001][HOME-003][HOME-004] 기본 홈 카드와 실제 설정 Command·version 충돌·동일 카드 거절을 검증한다', async ({ page, request }) => {
  const scope = await createHouseholdThroughUi(page);
  await expect(page.locator('.balance-card-glass')).toHaveCount(2);
  await expect(page.locator('.balance-card-glass').first()).toContainText('월 지출');
  await expect(page.locator('.balance-card-glass').nth(1)).toContainText('월 잔여 예산');
  const save = { ...scope, command: 'home.update-summary-preferences.v1', payload: { leftCard: 'yearlySpent', rightCard: 'localCurrencyBalance', expectedVersion: 0 }, commandId: 'e2e-home-config' };
  await executeHouseholdCommand(request, save);
  await expect(page.locator('.balance-card-glass').first()).toContainText('년 지출');
  await expect(page.locator('.balance-card-glass').nth(1)).toContainText('지역화폐 잔액');
  await expect(page.locator('.balance-card-glass').nth(1)).toContainText('데이터 없음');
  const stored = await documents(request, `households/${scope.householdId}/homePreferences`);
  expect(stored[0]).toMatchObject({ aggregateVersion: 1 });
  await executeHouseholdCommand(request, save);
  expect(await documents(request, `households/${scope.householdId}/homePreferences`)).toEqual(stored);
  await expect(executeHouseholdCommand(request, { ...scope, command: save.command, payload: { leftCard: 'monthlySpent', rightCard: 'monthlyRemainingBudget', expectedVersion: 0 } })).rejects.toThrow('HOME_CONFIGURATION_VERSION_MISMATCH');
  await expect(executeHouseholdCommand(request, { ...scope, command: save.command, payload: { leftCard: 'monthlySpent', rightCard: 'monthlySpent', expectedVersion: 1 } })).rejects.toThrow();
  expect(await documents(request, `households/${scope.householdId}/homePreferences`)).toEqual(stored);
  await page.reload();
  await expect(page.locator('.balance-card-glass').first()).toContainText('년 지출');
  await expect(page.locator('.balance-card-glass').nth(1)).toContainText('지역화폐 잔액');
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: /홈 카드 구성/ })).toHaveCount(0);
});

test('[T-THEME-001][THEME-001] 다섯 테마를 실제 설정에서 선택하면 배경이 달라지고 새로고침 뒤 선택이 복원된다', async ({ page }) => {
  await createHouseholdThroughUi(page);
  await page.goto('/settings');
  const backgrounds = new Set<string>();
  for (const label of ['파스텔 드림', '선셋 웜', '포레스트', '오션 블루', '미니멀 화이트']) {
    await page.getByRole('button', { name: /^테마/ }).click();
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    backgrounds.add(await page.evaluate(() => getComputedStyle(document.body).backgroundImage));
    await page.reload();
    await expect(page.getByRole('button', { name: /^테마/ })).toContainText(label);
  }
  expect(backgrounds.size).toBe(5);
  await page.evaluate(() => localStorage.setItem('app-theme', 'unsupported-theme'));
  await page.reload();
  await expect(page.getByRole('button', { name: /^테마/ })).toContainText('파스텔 드림');
  expect(await page.evaluate(() => localStorage.getItem('app-theme'))).toBe('unsupported-theme');
});
