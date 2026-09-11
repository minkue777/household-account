import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { callEmulatorFunction, createHouseholdThroughUi, executeHouseholdCommand, resetTestAccount, signInTestAccount } from './emulator';
import { documents, fixture, setEmulatorAdminClaims } from './portfolio-helpers';

test.beforeEach(async () => { await resetTestAccount(); });

test('[AST-006][ADM-001][ADM-002][ADM-004][ADM-005][EXT-001][EXT-002][EXT-004] 관리자 권한은 실제 token으로 검증하고 비용·삭제 자산 복구·가구 조회 전용 화면까지 연결된다', async ({ page, browser, request }) => {
  const scope = await createHouseholdThroughUi(page, '관리 대상 가구');
  const created = await executeHouseholdCommand<{ assetId: string }>(request, { ...scope, command: 'portfolio.create-asset.v1', payload: { asset: { name: '복구할 예금', type: 'savings', owner: '가구', ownerRef: { kind: 'household' }, currency: 'KRW', currentBalance: 25_000, isActive: true, order: 1 } } });
  await executeHouseholdCommand(request, { ...scope, command: 'portfolio.delete-asset.v1', payload: { assetId: created.assetId, expectedVersion: 1 } });
  const id = `e2e-admin-${randomUUID()}`;
  const denied = await callEmulatorFunction<{ result: { kind: string; error: { code: string } } }>(request, 'executeAdminAccess', {
    contractVersion: 'admin-access.v1', requestId: id, idempotencyKey: id,
    operation: 'list-deleted-assets', payload: { householdId: scope.householdId },
  }, scope.idToken);
  expect(denied.result).toMatchObject({ kind: 'rejected', error: { code: 'ADMIN_CAPABILITY_REQUIRED' } });
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '접근 권한 없음', exact: true })).toBeVisible();

  const now = new Date().toISOString();
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
  // Cloud Billing의 최신 성공 스냅샷만 준비합니다. BigQuery 집계 자체는 이 UI E2E 범위가 아닙니다.
  await fixture(request, 'operations/runtime/billingCostSnapshots/current', {
    schemaVersion: 1, status: 'available', billingMonth: month, currency: 'KRW',
    monthToDateAmount: 12_345, estimatedMonthEndAmount: 23_456, calculatedAt: now, dataUpdatedAt: now,
    serviceAmounts: [{ serviceId: 'firestore', serviceName: 'Cloud Firestore', amount: 12_345 }],
  });
  // Cloud Logging의 원시 HTTP 응답만 준비합니다. 실제 reader의 파싱·재시도
  // 중복 제거·통계 집계·callable 응답·화면 포맷은 대체하지 않습니다.
  const latencyEntry = (correlationId: string, secondsAgo: number, elapsedMs: number | string, status = 'succeeded') => ({
    timestamp: new Date(Date.parse(now) - secondsAgo * 1_000).toISOString(),
    jsonPayload: { message: 'interactive-latency', schemaVersion: 'interactive-latency.v1', stage: 'total',
      endpoint: 'executeHouseholdCommand', operation: 'ledger.update-transaction.v1', correlationId, elapsedMs, status },
  });
  await fixture(request, 'e2eGoogleCloudTransport/interactiveLatency', { entries: [
    latencyEntry('e2e-edit-a', 180, 9_000, 'failed'),
    latencyEntry('e2e-edit-a', 120, 1_000),
    latencyEntry('e2e-edit-b', 60, 3_000),
    latencyEntry('e2e-invalid-duration', 30, '60000'),
  ] });
  await setEmulatorAdminClaims(scope.uid);
  const householdName = String((await documents(request, 'households')).find(x => x.id === scope.householdId)!.name);
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  try {
    const admin = await context.newPage();
    await admin.goto('/');
    await admin.getByRole('button', { name: '테스트 계정으로 로그인' }).click();
    await expect(admin.locator('.calendar-glass')).toHaveAttribute('aria-busy', 'false');
    await admin.goto('/admin');
    await expect(admin.getByRole('heading', { name: 'Household Operations', exact: true })).toBeVisible();
    await expect(admin.getByText('12,345원', { exact: true }).first()).toBeVisible();
    await expect(admin.getByText('23,456원', { exact: true })).toBeVisible();
    await expect(admin.getByRole('heading', { name: '사용자 체감·서버 처리 시간', exact: true })).toBeVisible();
    const latency = admin.getByRole('row').filter({ hasText: 'ledger.update-transaction.v1' });
    await expect(latency).toHaveCount(1);
    await expect(latency.getByRole('cell').nth(1)).toContainText('지출·수입 수정');
    await expect(latency.getByRole('cell').nth(3)).toHaveText('2');
    await expect(latency.getByRole('cell').nth(4)).toHaveText('2/2');
    await expect(latency.getByRole('cell').nth(5)).toHaveText('2.000초');
    await expect(latency.getByRole('cell').nth(6)).toHaveText('3.000초');
    await expect(latency.getByRole('cell').nth(7)).toHaveText('3.000초');
    const loggingRequest = (await documents(request, 'e2eGoogleCloudTransport')).find(x => x.id === 'lastLoggingRequest')!;
    expect(loggingRequest).toMatchObject({ resourceNames: ['projects/demo-household-account-e2e'], orderBy: 'timestamp desc', pageSize: 250 });
    expect(String(loggingRequest.filter)).toMatch(/^timestamp>="[^"]+" AND timestamp<="[^"]+" AND jsonPayload.message="interactive-latency" AND jsonPayload.schemaVersion="interactive-latency.v1" AND jsonPayload.stage="total"$/);
    const household = admin.locator('article').filter({ has: admin.getByRole('heading', { name: householdName, exact: true }) });
    await household.getByRole('button', { name: '관리', exact: true }).click();
    const deleted = household.locator('div').filter({ has: admin.getByText(/^복구할 예금 · v/) }).last();
    await deleted.getByRole('button', { name: '복구', exact: true }).click();
    const reason = admin.getByRole('dialog').filter({ hasText: '복구' });
    await reason.getByRole('textbox').fill('E2E 오삭제 복구');
    await reason.getByRole('button', { name: '복구', exact: true }).click();
    await expect.poll(async () => (await documents(request, `households/${scope.householdId}/assets`)).find(x => x.id === created.assetId)?.lifecycleState).toBe('active');
    await household.getByRole('button', { name: '가계부 열기', exact: true }).click();
    await expect(admin.getByText('관리자 조회 전용 ·', { exact: false })).toBeVisible();
    await expect(admin.getByRole('link', { name: '관리자 화면', exact: true })).toBeVisible();
    await admin.goto('/assets');
    await expect(admin.locator(`[data-asset-id="${created.assetId}"]`)).toContainText('25,000');
    await expect(admin.getByRole('link', { name: '관리자 화면', exact: true })).toBeVisible();
    await admin.goto('/assets/stats');
    await expect(admin.getByRole('button', { name: '3개월', exact: true })).toBeVisible();
    await expect(admin.getByRole('link', { name: '관리자 화면', exact: true })).toBeVisible();
    expect((await documents(request, 'assets')).find(x => x.id === created.assetId)).toMatchObject({ currentBalance: 25_000, isActive: true });
  } finally { await context.close(); }
});

test('[ADM-003][HH-012] 실제 관리자 callable의 가구 삭제·복구와 마지막 가구원 제거·복구는 업무 데이터를 보존한다', async ({ page, request }) => {
  const scope = await createHouseholdThroughUi(page);
  const asset = await executeHouseholdCommand<{ assetId: string }>(request, { ...scope, command: 'portfolio.create-asset.v1', payload: { asset: { name: '보존할 자산', type: 'savings', owner: '가구', ownerRef: { kind: 'household' }, currentBalance: 51_000, currency: 'KRW', order: 1, isActive: true } } });
  await page.close();
  await setEmulatorAdminClaims(scope.uid);
  const admin = await signInTestAccount(request);
  const operation = async (operation: string, payload: unknown) => {
    const id = `e2e-admin-${randomUUID()}`;
    const result = await callEmulatorFunction<{ result: { kind: string; value?: unknown; error?: unknown } }>(request, 'executeAdminAccess', { contractVersion: 'admin-access.v1', requestId: id, idempotencyKey: id, operation, payload }, admin.idToken);
    expect(result.result, JSON.stringify(result.result.error)).toMatchObject({ kind: 'succeeded' });
    return result.result.value;
  };
  let household = (await documents(request, 'households')).find(x => x.id === scope.householdId)!;
  await operation('delete-household', { householdId: scope.householdId, expectedVersion: household.aggregateVersion, confirmed: true });
  household = (await documents(request, 'households')).find(x => x.id === scope.householdId)!;
  expect(household.lifecycleState).toBe('deleted');
  expect((await documents(request, 'assets')).find(x => x.id === asset.assetId)?.currentBalance).toBe(51_000);
  await operation('restore-household', { householdId: scope.householdId, expectedVersion: household.aggregateVersion, reason: 'E2E 복구' });
  expect((await documents(request, 'households')).find(x => x.id === scope.householdId)?.lifecycleState).toBe('active');
  let member = (await documents(request, `households/${scope.householdId}/members`)).find(x => x.id === scope.memberId)!;
  await operation('remove-household-member', { householdId: scope.householdId, memberId: scope.memberId, expectedVersion: member.aggregateVersion, reason: 'E2E 일시 제거' });
  member = (await documents(request, `households/${scope.householdId}/members`)).find(x => x.id === scope.memberId)!;
  expect(member.lifecycleState).not.toBe('active');
  expect((await documents(request, 'households')).find(x => x.id === scope.householdId)?.lifecycleState).toBe('active');
  await expect(executeHouseholdCommand(request, { ...scope, command: 'portfolio.update-asset.v1', payload: { assetId: asset.assetId, expectedVersion: 1, changes: { currentBalance: 0 } } })).rejects.toThrow();
  await operation('restore-household-member', { householdId: scope.householdId, memberId: scope.memberId, expectedVersion: member.aggregateVersion });
  expect((await documents(request, `households/${scope.householdId}/members`)).find(x => x.id === scope.memberId)?.lifecycleState).toBe('active');
  expect((await documents(request, 'assets')).find(x => x.id === asset.assetId)?.currentBalance).toBe(51_000);
});

test('[ADM-006] 실제 접속 command는 같은 문서 visitId 재전송을 중복 집계하지 않는다', async ({ page, request }) => {
  const scope = await createHouseholdThroughUi(page);
  await page.close();
  const commandId = `app-visit-e2e-${randomUUID()}`;
  const input = { ...scope, command: 'access.record-app-visit.v1', commandId, payload: { visitId: commandId, platform: 'web' } };
  const first = await executeHouseholdCommand<{ kind: string; totalAccessCount: number }>(request, input);
  const second = await executeHouseholdCommand<{ kind: string; totalAccessCount: number }>(request, input);
  expect(first.kind).toBe('recorded');
  expect(second.kind).toBe('already-recorded');
  expect(second.totalAccessCount).toBe(first.totalAccessCount);
  const stats = await documents(request, 'operations/runtime/memberAccessStats');
  expect(stats.find(x => x.memberId === scope.memberId)?.totalAccessCount).toBe(first.totalAccessCount);
});
