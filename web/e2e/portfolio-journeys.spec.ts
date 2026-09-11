import { expect, test } from '@playwright/test';
import { createHouseholdThroughUi, executeHouseholdCommand, resetTestAccount } from './emulator';
import { addAssetUi, documents, fixture, modal, runScheduled } from './portfolio-helpers';

test.beforeEach(async () => { await resetTestAccount(); });
test.use({ actionTimeout: 20_000 });

test('[T-AST-007][T-AST-010][AST-001][AST-002][AST-003][AST-006][AST-007][AST-009][HH-011] 명의자·자산 생성 수정 정렬 삭제가 저장 결과와 합계에 반영된다', async ({ page, request }) => {
  const scope = await createHouseholdThroughUi(page, '포트폴리오 가구');
  await page.goto('/assets');
  await expect(page.getByText('등록된 자산이 없습니다.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /샘플|데모|sample|demo/i })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /샘플|데모|sample|demo/i })).toHaveCount(0);
  await page.getByRole('button', { name: '자산 명의자 추가', exact: true }).click();
  const ownerModal = modal(page, '자산 명의자 추가');
  await ownerModal.getByPlaceholder('이름', { exact: true }).fill('아이');
  await ownerModal.getByRole('button', { name: '추가', exact: true }).click();
  await expect(ownerModal.getByText('아이', { exact: true })).toBeVisible();
  await expect(ownerModal.getByRole('button', { name: /삭제|보관/ })).toHaveCount(0);
  await ownerModal.getByRole('button', { name: '닫기', exact: true }).click();
  await addAssetUi(page, { name: '아이 예금', owner: '아이', balance: 100_000, memo: '정확한 원장' });
  await addAssetUi(page, { name: '공동 집', type: '부동산', owner: '가구', balance: 500_000 });
  await addAssetUi(page, { name: '공동 대출', type: '대출', owner: '가구', balance: 30_000 });
  await expect.poll(async () => (await documents(request, 'assets')).filter(x => x.householdId === scope.householdId).length).toBe(3);
  const assets = await documents(request, 'assets');
  const savings = assets.find(x => x.name === '아이 예금')!;
  const owner = (await documents(request, `households/${scope.householdId}/assetOwnerProfiles`)).find(x => x.displayName === '아이')!;
  expect(savings).toMatchObject({ currentBalance: 100_000, ownerRef: { kind: 'profile', profileId: owner.id }, isActive: true, aggregateVersion: 1 });
  expect((await documents(request, `households/${scope.householdId}/assets`)).find(x => x.id === savings.id)).toMatchObject({ lifecycleState: 'active' });
  await expect(page.locator('[data-asset-id]').filter({ hasText: '공동 대출' })).toContainText('-30,000');
  await expect(page.getByText(/^570,000\s*원$/).first()).toBeVisible();
  await page.getByRole('button', { name: '아이', exact: true }).click();
  await expect(page.locator('[data-asset-id]')).toHaveCount(1);
  await expect(page.getByText(/^100,000\s*원$/).first()).toBeVisible();
  await page.getByRole('button', { name: '전체', exact: true }).click();
  await page.locator('[data-asset-id]').filter({ hasText: '아이 예금' }).click();
  const edit = modal(page, '자산 수정');
  await expect(edit.locator('input').first()).toHaveValue('아이 예금');
  await edit.getByPlaceholder('0', { exact: true }).fill('120000');
  await edit.getByPlaceholder('메모 입력').fill('변경된 메모');
  await edit.getByRole('button', { name: '저장', exact: true }).click();
  await expect.poll(async () => (await documents(request, 'assets')).find(x => x.id === savings.id)).toMatchObject({ currentBalance: 120_000, memo: '변경된 메모', aggregateVersion: 2 });
  await expect(page.getByText(/^590,000\s*원$/).first()).toBeVisible();

  const first = page.locator('[data-asset-id]').first();
  const last = page.locator('[data-asset-id]').last();
  const original = await page.locator('[data-asset-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-asset-id')));
  await first.dragTo(last);
  await expect.poll(async () => (await documents(request, 'assets')).sort((a, b) => Number(a.order) - Number(b.order)).map(x => x.id)).not.toEqual(original);
  const storedOrder = (await documents(request, 'assets')).sort((a, b) => Number(a.order) - Number(b.order)).map(x => x.id);
  await page.reload();
  await expect.poll(() => page.locator('[data-asset-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-asset-id')))).toEqual(storedOrder);
  await fixture(request, `asset_history/preserved-${savings.id}`, { householdId: scope.householdId, assetId: savings.id, date: '2024-01-01', balance: 100_000 });
  await page.locator(`[data-asset-id="${savings.id}"]`).click();
  // 현재 자산 편집의 첫 번째 icon button이 삭제 버튼입니다(접근성 이름 미제공).
  await edit.locator('button').first().click();
  await page.getByRole('dialog', { name: '자산 삭제' }).getByRole('button', { name: '삭제', exact: true }).click();
  await expect.poll(async () => (await documents(request, `households/${scope.householdId}/assets`)).find(x => x.id === savings.id)?.lifecycleState).toBe('deleted');
  expect((await documents(request, 'asset_history')).find(x => x.id === `preserved-${savings.id}`)).toBeDefined();
  await expect(page.locator(`[data-asset-id="${savings.id}"]`)).toHaveCount(0);
  await expect(page.getByText(/^470,000\s*원$/).first()).toBeVisible();
});

test('[T-LOAN-002][LOAN-001][LOAN-002][AUTO-003] 실제 대출 자동상환은 원금균등·원리금균등의 다른 감소액을 한 번씩 반영한다', async ({ page, request }) => {
  const scope = await createHouseholdThroughUi(page);
  const assets: { id: string; amount: number }[] = [];
  for (const [name, method, expected] of [['원금균등 대출', '원금균등상환', 100_000], ['원리금균등 대출', '원리금균등상환', 90_000]] as const) {
    const created = await executeHouseholdCommand<{ assetId: string }>(request, { ...scope, command: 'portfolio.create-asset.v1', payload: { asset: { name, type: 'loan', subType: '신용대출', owner: '가구', ownerRef: { kind: 'household' }, currency: 'KRW', currentBalance: 1_000_000, loanInterestRate: 12, loanRepaymentMethod: method, loanMonthlyPaymentAmount: 100_000, loanPaymentDay: 31, isActive: true, order: assets.length } } });
    assets.push({ id: created.assetId, amount: 1_000_000 - expected });
  }
  const plans = await documents(request, `households/${scope.householdId}/assetAutomationPlans`);
  expect(plans).toHaveLength(2);
  const due = String(plans[0].nextDueDate);
  await runScheduled('assetAutomationDaily', `${due}T00:00:00+09:00`);
  for (const asset of assets) expect((await documents(request, 'assets')).find(x => x.id === asset.id)?.currentBalance).toBe(asset.amount);
  await runScheduled('assetAutomationDaily', `${due}T00:00:00+09:00`);
  for (const asset of assets) expect((await documents(request, 'assets')).find(x => x.id === asset.id)?.currentBalance).toBe(asset.amount);
});

test('[HOLD-001][HOLD-003][HOLD-004][HOLD-005] 수동 보유 항목 CRUD는 부모 평가와 version까지 저장하고 재진입에서 유지된다', async ({ page, request }) => {
  await createHouseholdThroughUi(page);
  await page.goto('/assets');
  await expect(page.getByText('등록된 자산이 없습니다.', { exact: true })).toBeVisible();
  await addAssetUi(page, { name: '증권계좌', type: '주식' });
  const asset = (await documents(request, 'assets')).find(x => x.name === '증권계좌')!;
  await page.locator(`[data-asset-id="${asset.id}"]`).click();
  const detail = modal(page, '증권계좌');
  await detail.getByRole('button', { name: '수동 추가', exact: true }).click();
  await detail.getByPlaceholder('항목명 입력').fill('현금성 항목');
  await detail.getByPlaceholder('0', { exact: true }).fill('15000');
  await detail.getByRole('button', { name: '항목 추가', exact: true }).click();
  await expect(detail.getByRole('button', { name: /현금성 항목/ })).toBeVisible();
  await expect.poll(async () => (await documents(request, 'assets')).find(x => x.id === asset.id)).toMatchObject({ currentBalance: 15_000, aggregateVersion: 2 });
  await detail.getByRole('button', { name: /현금성 항목/ }).click();
  await detail.getByLabel('금액', { exact: true }).fill('27000');
  await detail.getByRole('button', { name: '저장', exact: true }).click();
  await expect.poll(async () => (await documents(request, 'assets')).find(x => x.id === asset.id)).toMatchObject({ currentBalance: 27_000, aggregateVersion: 3 });
  await detail.getByRole('button', { name: '닫기', exact: true }).click();
  await page.locator(`[data-asset-id="${asset.id}"]`).click();
  await expect(detail.getByRole('button', { name: /현금성 항목/ })).toContainText('수동');
  await detail.getByRole('button', { name: /현금성 항목/ }).click();
  await expect(detail.getByLabel('금액', { exact: true })).toHaveValue('27,000');
  await detail.getByRole('button', { name: '삭제', exact: true }).click();
  await page.getByRole('dialog', { name: '보유 항목 삭제' }).getByRole('button', { name: '삭제', exact: true }).click();
  await expect.poll(async () => (await documents(request, 'assets')).find(x => x.id === asset.id)).toMatchObject({ currentBalance: 0, costBasis: 0, aggregateVersion: 4 });
  await expect(detail.getByRole('button', { name: /현금성 항목/ })).toHaveCount(0);
});

test('[AUTO-001][AUTO-002][AUTO-003][JOB-ERR-001][JOB-ERR-002] UI 적금 생성 뒤 실제 Scheduler가 도래 월만 한 번 반영한다', async ({ page, request }) => {
  const scope = await createHouseholdThroughUi(page);
  await page.goto('/assets');
  await expect(page.getByText('등록된 자산이 없습니다.', { exact: true })).toBeVisible();
  await addAssetUi(page, { name: '자동 적금', subType: '적금', balance: 100_000, amount: 20_000, day: 31 });
  const asset = (await documents(request, 'assets')).find(x => x.name === '자동 적금')!;
  await expect.poll(async () => (await documents(request, `households/${scope.householdId}/assetAutomationPlans`)).length).toBe(1);
  const plan = (await documents(request, `households/${scope.householdId}/assetAutomationPlans`))[0];
  expect(asset.currentBalance).toBe(100_000);
  const due = String(plan.nextDueDate);
  await runScheduled('assetAutomationDaily', `${due}T00:00:00+09:00`);
  await expect.poll(async () => (await documents(request, 'assets')).find(x => x.id === asset.id)?.currentBalance).toBe(120_000);
  const after = (await documents(request, `households/${scope.householdId}/assetAutomationPlans`))[0];
  expect(String(after.nextDueDate) > due).toBe(true);
  await runScheduled('assetAutomationDaily', `${due}T00:00:00+09:00`);
  expect((await documents(request, 'assets')).find(x => x.id === asset.id)?.currentBalance).toBe(120_000);
  await page.reload();
  await expect(page.locator(`[data-asset-id="${asset.id}"]`)).toContainText('120,000');
});

test('[T-HOLD-003][HOLD-002][HOLD-003][HOLD-004][AST-001][AST-003] 실제 callable은 코인 평가를 반영하고 stale position/asset 및 잘못된 순서를 원자 거절한다', async ({ page, request }) => {
  const scope = await createHouseholdThroughUi(page);
  const create = await executeHouseholdCommand<{ assetId: string }>(request, { ...scope, command: 'portfolio.create-asset.v1', payload: { asset: { name: '코인계좌', type: 'crypto', owner: '공동', ownerRef: { kind: 'household' }, currency: 'KRW', currentBalance: 0, isActive: true, order: 1 } } });
  await executeHouseholdCommand(request, { ...scope, command: 'portfolio.add-position.v1', payload: { assetId: create.assetId, positionKind: 'crypto', expectedAssetVersion: 1, position: { assetId: create.assetId, marketCode: 'KRW-BTC', coinName: '비트코인', quantity: 0.25, avgPrice: 100_001, currentPrice: 120_003 } } });
  const asset = (await documents(request, 'assets')).find(x => x.id === create.assetId)!;
  expect(asset).toMatchObject({ currentBalance: 30_001, costBasis: 25_000, aggregateVersion: 2 });
  const positions = await documents(request, 'crypto_holdings');
  expect(positions).toHaveLength(1);
  const before = await documents(request, 'assets');
  await expect(executeHouseholdCommand(request, { ...scope, command: 'portfolio.update-position.v1', payload: { assetId: create.assetId, positionId: positions[0].id, positionKind: 'crypto', changes: { quantity: 1 }, expectedVersion: 1, expectedAssetVersion: 1 } })).rejects.toThrow();
  expect(await documents(request, 'assets')).toEqual(before);
  expect(await documents(request, 'crypto_holdings')).toEqual(positions);
  await expect(executeHouseholdCommand(request, { ...scope, command: 'portfolio.reorder-assets.v1', payload: { assets: [{ assetId: create.assetId, order: 0 }, { assetId: create.assetId, order: 1 }], expectedVersions: { [create.assetId]: 2 } } })).rejects.toThrow();
  expect(await documents(request, 'assets')).toEqual(before);
  await expect(executeHouseholdCommand(request, { ...scope, command: 'portfolio.create-asset.v1', payload: { asset: { name: '', type: 'savings', ownerRef: { kind: 'household' }, currentBalance: 1, currency: 'KRW', order: 2 } } })).rejects.toThrow();
  expect(await documents(request, 'assets')).toEqual(before);
});
