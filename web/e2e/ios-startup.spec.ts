import { expect, test, type Page, type Request, type Response } from '@playwright/test';
import { observeIndexedDbOpens, readFirestoreCollection, readIndexedDbOpens, resetTestAccount, writeFirestoreFixture } from './emulator';

const COMPLETE_PAINT = 'household-account:startup:home:first-complete-paint';

function isAppVisit(request: Request): boolean {
  return request.method() === 'POST'
    && request.url().endsWith('/executeHouseholdCommand')
    && request.postDataJSON()?.data?.command === 'access.record-app-visit.v1';
}

function observeAppVisits(page: Page) {
  const requests: Request[] = [];
  const responses: Response[] = [];
  // 요청을 변경하거나 응답을 대체하지 않고 실제 SDK 전송만 관찰합니다.
  page.on('request', (request) => { if (isAppVisit(request)) requests.push(request); });
  page.on('response', (response) => { if (isAppVisit(response.request())) responses.push(response); });
  return { requests, responses };
}

async function acceptedAppVisit(observed: ReturnType<typeof observeAppVisits>) {
  await expect.poll(() => observed.responses.length, {
    message: '실제 접속 Command가 서버 응답까지 완료되어야 합니다.',
  }).toBe(1);
  expect(observed.requests).toHaveLength(1);
  const response = observed.responses[0];
  expect(response.ok()).toBe(true);
  const envelope = response.request().postDataJSON().data;
  const body = await response.json();
  expect(body.error).toBeUndefined();
  expect(body.result.contractVersion).toBe('household-command-response.v1');
  expect(body.result.commandId).toBe(envelope.commandId);
  expect(body.result.result.kind).toBe('succeeded');
  expect(body.result.result.value.kind).toBe('recorded');
  expect(envelope.payload.platform).toBe('ios-pwa');
  return envelope.payload as {
    visitId: string;
    clientStartupDurationMs: number;
    clientStartupDiagnostics?: {
      version: number;
      webBuild?: string;
      navigationType?: string;
      initialVisibility: string;
      visibilityTrackingStartedAtMs: number;
      hiddenMs: number;
      hiddenCount: number;
      serviceWorkerControlled?: boolean;
      yearSummaryRequired?: boolean;
      cache?: { bootstrap?: string; membership?: string; household?: string };
      timingsMs: Record<string, number>;
    };
  };
}
test.beforeEach(async () => { await resetTestAccount(); });

test('[T-SYS-008][T-ADM-005][ADM-006][AND-012][SYS-008] iPhone WebKit 재실행은 로그인 유지와 Firestore IndexedDB 대기 없이 최신 홈을 표시한다', async ({ page: initialPage, context, request }) => {
  let page = initialPage;
  // WebKit의 standalone 감지만 설정합니다. Auth/Firestore SDK와 서버 응답은 실제입니다.
  await observeIndexedDbOpens(page, true);
  const errors: string[] = [];
  const initialVisits = observeAppVisits(page);
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
  const initialVisit = await acceptedAppVisit(initialVisits);

  // 열린 stream을 가로채지 않고 실제 재실행을 검사합니다. 앱이 닫힌 동안
  // 서버 잔액을 바꿔 이전 화면의 값이 아니라 최신 결과를 읽는지 확인합니다.
  await page.close();
  await writeFirestoreFixture(request, `households/${householdId}/localCurrencyBalances/gyeonggi`, {
    localCurrencyType: { stringValue: 'gyeonggi' }, balanceInWon: { integerValue: '36890' },
  });
  page = await context.newPage();
  await observeIndexedDbOpens(page, true);
  const restartedVisits = observeAppVisits(page);
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

  const restartedVisit = await acceptedAppVisit(restartedVisits);
  expect(restartedVisit.visitId).not.toBe(initialVisit.visitId);
  const diagnostics = restartedVisit.clientStartupDiagnostics;
  expect(diagnostics, '재실행의 실제 접속 요청에 상세 시작 진단을 포함해야 합니다.').toBeDefined();
  if (!diagnostics) throw new Error('IOS_STARTUP_DIAGNOSTICS_MISSING');
  expect(diagnostics.version).toBe(1);
  expect(diagnostics.webBuild).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
  expect(diagnostics.webBuild).toBe(initialVisit.clientStartupDiagnostics?.webBuild);
  expect((await request.get(`/_next/static/${diagnostics.webBuild}/_buildManifest.js`)).ok()).toBe(true);
  expect(diagnostics.initialVisibility).toBe('visible');
  expect(diagnostics.hiddenMs).toBe(0);
  expect(diagnostics.hiddenCount).toBe(0);
  expect(typeof diagnostics.serviceWorkerControlled).toBe('boolean');
  expect(diagnostics.yearSummaryRequired).toBe(false);

  const browserTiming = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return {
      now: performance.now(),
      navigation: {
        type: navigation.type,
        responseStart: navigation.responseStart,
        responseEnd: navigation.responseEnd,
        domInteractive: navigation.domInteractive,
      },
      marks: Object.fromEntries(performance.getEntriesByType('mark')
        .map((entry) => [entry.name, entry.startTime])),
    };
  });
  expect(diagnostics.navigationType).toBe(browserTiming.navigation.type);
  expect(Number.isFinite(restartedVisit.clientStartupDurationMs)).toBe(true);
  expect(restartedVisit.clientStartupDurationMs).toBeGreaterThan(0);
  expect(restartedVisit.clientStartupDurationMs).toBeLessThanOrEqual(browserTiming.now);
  expect(diagnostics.visibilityTrackingStartedAtMs).toBeGreaterThanOrEqual(0);
  expect(diagnostics.visibilityTrackingStartedAtMs).toBeLessThanOrEqual(restartedVisit.clientStartupDurationMs);

  const timings = diagnostics.timingsMs;
  for (const [key, browserValue] of Object.entries({
    navigationResponseStart: browserTiming.navigation.responseStart,
    navigationResponseEnd: browserTiming.navigation.responseEnd,
    domInteractive: browserTiming.navigation.domInteractive,
  })) {
    expect(timings[key], `${key}는 Navigation Timing의 offset이어야 합니다.`).toBeCloseTo(browserValue, 2);
  }
  const phaseMarks = {
    bootstrapStarted: 'bootstrap:started', authStarted: 'auth:started', authReady: 'auth:ready',
    membershipStarted: 'membership:started', membershipReady: 'membership:ready',
    householdStarted: 'household:started', householdReady: 'household:ready',
    ledgerReady: 'ledger:ready', categoriesReady: 'categories:ready',
    localCurrencyReady: 'local-currency:ready', yearSummaryReady: 'year-summary:ready',
    homeReady: 'home:ready', firstLedgerPaint: 'ledger:first-paint',
    firstHomeCompletePaint: 'home:first-complete-paint',
  };
  for (const key of ['bootstrapStarted', 'authStarted', 'authReady', 'ledgerReady',
    'categoriesReady', 'localCurrencyReady', 'homeReady', 'firstLedgerPaint', 'firstHomeCompletePaint']) {
    expect(timings, `${key}의 최초 실제 준비 시각을 기록해야 합니다.`).toHaveProperty(key);
  }
  expect(timings.yearSummaryReady).toBeUndefined();
  for (const [key, value] of Object.entries(timings)) {
    expect(Number.isFinite(value), `${key}는 유한한 navigation offset이어야 합니다.`).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(restartedVisit.clientStartupDurationMs);
    if (key in phaseMarks) {
      const mark = browserTiming.marks[`household-account:startup:${phaseMarks[key as keyof typeof phaseMarks]}`];
      expect(mark, `${key}와 대응하는 실제 Performance mark가 있어야 합니다.`).toBeDefined();
      // 동일 callback의 mark와 진단 관측 사이의 미세한 실행 시간만 허용합니다.
      expect(Math.abs(value - mark), `${key}를 구간 duration 또는 epoch로 기록하면 안 됩니다.`).toBeLessThan(25);
    }
  }
  expect(timings.homeReady).toBeGreaterThanOrEqual(Math.max(
    timings.ledgerReady, timings.categoriesReady, timings.localCurrencyReady
  ));
  expect(timings.firstHomeCompletePaint).toBeGreaterThanOrEqual(timings.homeReady);
  expect(diagnostics.cache?.membership).toBe('hit');
  for (const cache of ['bootstrap', 'household'] as const) {
    const markPrefix = `household-account:startup:${cache}-cache:`;
    const observedCache = browserTiming.marks[`${markPrefix}hit`] !== undefined ? 'hit'
      : browserTiming.marks[`${markPrefix}miss`] !== undefined ? 'miss' : undefined;
    expect(diagnostics.cache?.[cache], '실제로 관측하지 않은 cache 결과를 추정하지 않습니다.').toBe(observedCache);
  }
  expect(restartedVisits.requests, '홈 표시와 날짜 선택은 같은 문서의 접속 진단을 다시 보내면 안 됩니다.').toHaveLength(1);
  expect(initialVisits.requests).toHaveLength(1);
  expect(errors).toEqual([]);
});
