import { expect, test } from '@playwright/test';
import { observeIndexedDbOpens, readFirestoreCollection, readIndexedDbOpens, resetTestAccount, writeFirestoreFixture } from './emulator';

const COMPLETE_PAINT = 'household-account:startup:home:first-complete-paint';
test.beforeEach(async () => { await resetTestAccount(); });

test('[T-SYS-008][AND-012][SYS-008] iPhone WebKit 재실행은 로그인 유지와 Firestore IndexedDB 대기 없이 최신 홈을 표시한다', async ({ page: initialPage, context, request }, testInfo) => {
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

  const visitResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/executeHouseholdCommand')
    && response.request().method() === 'POST'
    && response.request().postDataJSON()?.data?.command === 'access.record-app-visit.v1'
  );
  // 앞선 화면 검증이 실패해 페이지가 닫혀도 관측 promise가 별도 오류를 만들지 않습니다.
  void visitResponsePromise.catch(() => {});
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

  // 실제 SDK의 재실행 경로에서 관측한 단계만 저장합니다. 로컬 WebKit의 시간을
  // 실기기 목표값으로 취급하지 않고 요청·응답·완료 순서와 누락을 확인합니다.
  const startup = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return {
      entries: performance.getEntries()
        .filter((entry) => entry.name.startsWith('household-account:startup:'))
        .map(({ name, entryType, startTime, duration }) => ({ name, entryType, startTime, duration }))
        .sort((left, right) => left.startTime - right.startTime),
      navigation: navigation ? {
        requestStart: navigation.requestStart,
        responseStart: navigation.responseStart,
        responseEnd: navigation.responseEnd,
        domInteractive: navigation.domInteractive,
        domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
      } : undefined,
    };
  });
  const visitResponse = await visitResponsePromise;
  const visitEnvelope = visitResponse.request().postDataJSON().data;
  const visitPayload = visitEnvelope.payload;
  const visitResult = (await visitResponse.json()).result;
  await testInfo.attach('ios-restart-startup-timings.json', {
    body: JSON.stringify({
      environment: 'local Playwright WebKit; not an iPhone timing result',
      ...startup,
      transmitted: {
        platform: visitPayload.platform,
        clientStartupDurationMs: visitPayload.clientStartupDurationMs,
        clientStartupTimingsMs: visitPayload.clientStartupTimingsMs,
      },
      server: {
        status: visitResponse.status(),
        outcome: visitResult?.result?.kind,
        accessResult: visitResult?.result?.value?.kind,
      },
    }, null, 2),
    contentType: 'application/json',
  });
  expect(visitResponse.status()).toBe(200);
  expect(visitResult.commandId).toBe(visitEnvelope.commandId);
  expect(visitResult.result).toMatchObject({ kind: 'succeeded', value: { kind: 'recorded' } });
  expect(visitPayload.platform).toBe('ios-pwa');
  expect(Number.isFinite(visitPayload.clientStartupDurationMs)).toBe(true);
  expect(visitPayload.clientStartupTimingsMs).toEqual(expect.any(Object));
  const marks = new Map(startup.entries
    .filter((entry) => entry.entryType === 'mark')
    .map((entry) => [entry.name, entry.startTime]));
  const prefix = 'household-account:startup:';
  for (const suffix of [
    'bootstrap:started', 'auth:started', 'auth:ready', 'membership-cache:hit',
    'session:ready', 'ledger:first-paint', 'home:first-complete-paint',
    'ledger:requested', 'ledger:ready', 'categories:requested', 'categories:ready',
    'local-currency:requested', 'local-currency:ready',
  ]) {
    expect(marks.has(`${prefix}${suffix}`), `재실행 단계 누락: ${suffix}`).toBe(true);
  }
  expect(marks.get(`${prefix}auth:ready`)!).toBeLessThanOrEqual(marks.get(`${prefix}session:ready`)!);
  for (const source of ['ledger', 'categories', 'local-currency']) {
    expect(marks.get(`${prefix}${source}:requested`)!).toBeLessThanOrEqual(marks.get(`${prefix}${source}:ready`)!);
    expect(marks.get(`${prefix}${source}:ready`)!).toBeLessThanOrEqual(marks.get(COMPLETE_PAINT)!);
  }
  for (const [key, suffix] of [
    ['bootstrapStarted', 'bootstrap:started'], ['authStarted', 'auth:started'], ['authReady', 'auth:ready'],
    ['sessionReady', 'session:ready'], ['firstLedgerPaint', 'ledger:first-paint'],
    ['firstHomeCompletePaint', 'home:first-complete-paint'],
    ['ledgerRequested', 'ledger:requested'], ['ledgerReady', 'ledger:ready'],
    ['categoriesRequested', 'categories:requested'], ['categoriesReady', 'categories:ready'],
    ['localCurrencyRequested', 'local-currency:requested'], ['localCurrencyReady', 'local-currency:ready'],
  ]) {
    expect(visitPayload.clientStartupTimingsMs[key], `서버로 전달된 단계: ${key}`)
      .toBeCloseTo(marks.get(`${prefix}${suffix}`)!, 2);
  }
  expect(visitPayload.clientStartupDurationMs).toBeGreaterThanOrEqual(visitPayload.clientStartupTimingsMs.firstHomeCompletePaint);
  const databaseNames = await readIndexedDbOpens(page);
  expect(databaseNames.some((name) => name === 'firebaseLocalStorageDb')).toBe(true);
  expect(databaseNames.some((name) => name.startsWith('firestore/'))).toBe(false);
  expect(errors).toEqual([]);
});
