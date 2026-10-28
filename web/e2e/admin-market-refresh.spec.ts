import { expect, test } from '@playwright/test';
import { createEmulatorAccount, createHouseholdThroughUi, executeHouseholdCommand, resetTestAccount, signInTestAccount } from './emulator';
import { documents, setEmulatorAdminClaims } from './portfolio-helpers';

test('[ADM-004][T-ADM-003][JOB-AST-001] 비회원 관리자 화면의 자동 갱신·개별 callable 권한을 확인하고 자산 편집은 거부한다', async ({ page, browser, request }) => {
  await resetTestAccount();
  const operator = await createHouseholdThroughUi(page, '운영자 본인 가구');
  const baseURL = new URL(page.url()).origin;
  const owner = await createEmulatorAccount(request, 'market-owner@household.test');
  const target = await executeHouseholdCommand<{ householdId: string; memberId: string }>(request, {
    idToken: owner.idToken, command: 'access.create-household-with-self.v1', payload: { householdName: '시세 갱신 대상', memberName: '명의자' },
  });
  const scope = { idToken: owner.idToken, householdId: target.householdId };
  const householdName = String((await documents(request, 'households')).find(item => item.id === target.householdId)!.name);
  const asset = await executeHouseholdCommand<{ assetId: string }>(request, { ...scope, command: 'portfolio.create-asset.v1',
    payload: { asset: { name: '관리자 갱신 계좌', type: 'stock', ownerRef: { kind: 'household' }, currency: 'KRW', currentBalance: 0, isActive: true, order: 0, memo: '보존할 메모' } },
  });
  // 예수금 계좌는 외부 시세 대상 0건입니다. 실제 가격 반영은 서버 계약 검사에서
  // Quote 경계만 고정하고 동일 application·Firestore adapter를 거쳐 검증합니다.
  await executeHouseholdCommand(request, { ...scope, command: 'portfolio.add-position.v1', payload: {
    assetId: asset.assetId, positionKind: 'stock', expectedAssetVersion: 1,
    position: { holdingType: 'cash', stockCode: '', stockName: '예수금', quantity: 1, currentPrice: 25_000 },
  } });
  await expect(executeHouseholdCommand(request, { idToken: operator.idToken, householdId: target.householdId,
    command: 'portfolio.refresh-market-values.v1', payload: { assetClass: 'all' },
  })).rejects.toThrow('HOUSEHOLD_FORBIDDEN');
  await page.close();
  await setEmulatorAdminClaims(operator.uid);
  const administrator = await signInTestAccount(request);
  await expect(executeHouseholdCommand(request, { idToken: administrator.idToken, householdId: target.householdId,
    command: 'portfolio.delete-asset.v1', payload: { assetId: asset.assetId, expectedVersion: 2 },
  })).rejects.toThrow('HOUSEHOLD_FORBIDDEN');
  const context = await browser.newContext({ baseURL, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  try {
    const admin = await context.newPage();
    await admin.goto('/');
    await admin.getByRole('button', { name: '테스트 계정으로 로그인' }).click();
    await expect(admin.locator('.calendar-glass')).toHaveAttribute('aria-busy', 'false');
    await admin.goto('/admin');
    const household = admin.locator('article').filter({ has: admin.getByRole('heading', { name: householdName, exact: true }) });
    await household.getByRole('button', { name: '가계부 열기', exact: true }).click();
    await expect(admin.getByText('관리자 조회 전용 ·', { exact: false })).toBeVisible();
    const nextRefresh = () => admin.waitForResponse(response => response.url().endsWith('/executeHouseholdCommand')
      && response.request().method() === 'POST'
      && response.request().postDataJSON()?.data?.command === 'portfolio.refresh-market-values.v1');
    const initial = nextRefresh();
    await admin.goto('/assets');
    const response = await initial;
    expect(response.request().postDataJSON().data).toMatchObject({ householdId: target.householdId, payload: { assetClass: 'all' } });
    expect((await response.json()).result.result).toMatchObject({ kind: 'succeeded', value: { failedCount: 0 } });
    const row = admin.locator(`[data-asset-id="${asset.assetId}"]`);
    await expect(row).toContainText('25,000');
    await row.getByText('관리자 갱신 계좌', { exact: true }).click();
    // 예수금만 있으면 수동 버튼을 숨기는 기존 UI 계약을 유지한다.
    await expect(admin.getByRole('button', { name: '시세 갱신', exact: true })).toHaveCount(0);
    const individual = await executeHouseholdCommand(request, { idToken: administrator.idToken, householdId: target.householdId,
      command: 'portfolio.refresh-market-values.v1', payload: { assetClass: 'stock', assetId: asset.assetId },
    });
    expect(individual).toMatchObject({ refreshedCount: 0, failedCount: 0 });
    expect((await documents(request, `households/${target.householdId}/assets`)).find(item => item.id === asset.assetId))
      .toMatchObject({ currentBalance: 25_000, memo: '보존할 메모', lifecycleState: 'active' });
    expect((await documents(request, `households/${target.householdId}/memberships`)).some(item => item.id === operator.uid)).toBe(false);
  } finally { await context.close(); }
});
