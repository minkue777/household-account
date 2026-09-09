import {
  devices,
  expect,
  test,
  type APIRequestContext,
  type CDPSession,
  type Page,
} from '@playwright/test';
import {
  type FirestoreDocument,
  readExpenseDocuments,
  readFirestoreCollection,
} from './emulator';

const CREATED_MERCHANT = 'E2E 원장 카페';
const UPDATED_MERCHANT = 'E2E 수정 카페';
const EXPENSE_AMOUNT = 12_300;

function todayInSeoul(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function documentId(document: FirestoreDocument): string {
  return document.name.slice(document.name.lastIndexOf('/') + 1);
}

async function findExpense(
  request: APIRequestContext,
  id: string
): Promise<FirestoreDocument | undefined> {
  return (await readExpenseDocuments(request))
    .find((document) => documentId(document) === id);
}

async function dragCategoryByTouch(
  page: Page,
  session: CDPSession,
  sourceLabel: string,
  targetLabel: string
): Promise<void> {
  const list = page.getByTestId('category-order-list');
  await list.scrollIntoViewIfNeeded();
  const source = list.getByRole('button', { name: `${sourceLabel} 순서 이동`, exact: true });
  const target = list.getByRole('button', { name: `${targetLabel} 순서 이동`, exact: true });
  await expect(source).toBeEnabled();
  await expect(target).toBeEnabled();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  const start = {
    x: sourceBox!.x + sourceBox!.width / 2,
    y: sourceBox!.y + sourceBox!.height / 2,
  };
  const end = {
    x: targetBox!.x + targetBox!.width / 2,
    y: targetBox!.y + targetBox!.height / 2,
  };

  // DOM dispatchEvent/HTML drag 대신 Chromium 입력 경계에서 실제 touch를 전달합니다.
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...start, id: 1 }],
  });
  for (let step = 1; step <= 8; step += 1) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        x: start.x + (end.x - start.x) * step / 8,
        y: start.y + (end.y - start.y) * step / 8,
        id: 1,
      }],
    });
  }
  await expect.poll(() => source.evaluate((button) =>
    getComputedStyle(button.closest('[data-category-id]')!).transform
  )).not.toBe('none');
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function expectStoredCategoryOrder(
  request: APIRequestContext,
  householdId: string,
  expectedKeys: string[],
  expectedVersion: number
): Promise<void> {
  await expect.poll(async () => {
    const [canonical, projection, settings, households] = await Promise.all([
      readFirestoreCollection(request, `households/${householdId}/categories`),
      readFirestoreCollection(request, 'categories'),
      readFirestoreCollection(request, `households/${householdId}/categorySettings`),
      readFirestoreCollection(request, 'households'),
    ]);
    return {
      canonical: canonical
        .filter((document) => document.fields?.state?.stringValue === 'active')
        .sort((left, right) => Number(left.fields?.sortOrder?.integerValue)
          - Number(right.fields?.sortOrder?.integerValue))
        .map((document) => document.fields?.categoryId?.stringValue),
      projection: projection
        .filter((document) => document.fields?.householdId?.stringValue === householdId
          && document.fields?.isActive?.booleanValue === true)
        .sort((left, right) => Number(left.fields?.order?.integerValue)
          - Number(right.fields?.order?.integerValue))
        .map((document) => document.fields?.key?.stringValue),
      catalogVersion: Number(settings.find((document) => documentId(document) === 'default')
        ?.fields?.catalogVersion?.integerValue),
      householdVersion: Number(households.find((document) => documentId(document) === householdId)
        ?.fields?.categoryCatalogVersion?.integerValue),
    };
  }).toEqual({
    canonical: expectedKeys,
    projection: expectedKeys,
    catalogVersion: expectedVersion,
    householdVersion: expectedVersion,
  });
}

test('[T-CAT-007][CAT-002] 로그인·지출 CRUD·모바일 카테고리 순서 변경이 실제 Firebase 경계를 통과한다', async ({
  browser,
  page,
  request,
}, testInfo) => {
  const today = todayInSeoul();
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto('/');

  await page.getByRole('button', { name: '테스트 계정으로 로그인' }).click();
  await expect(
    page.getByRole('button', { name: '새 가계부 만들기' })
  ).toBeVisible();

  await page.getByRole('button', { name: '새 가계부 만들기' }).click();
  await page.getByLabel('가계부 이름').fill('E2E 테스트');
  await page.getByPlaceholder('내 이름').fill('테스터');
  await page.getByRole('button', { name: '가계부 만들기' }).click();

  const calendar = page.locator('.calendar-glass');
  await expect(calendar).toBeVisible();
  await expect(calendar).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByText('데이터가 없습니다', { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const categories = await readFirestoreCollection(request, 'categories');
    return categories
      .filter((document) => document.fields?.isActive?.booleanValue === true)
      .map((document) => document.fields?.key?.stringValue)
      .sort();
  }).toEqual(['childcare', 'etc', 'fixed', 'food', 'living']);

  await page.getByTestId(`calendar-day-${today}`).click();
  await expect(page.getByText('지출 내역이 없습니다', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '지출 추가' }).click();

  const addDialog = page.getByRole('dialog', { name: '지출 추가' });
  await addDialog.getByPlaceholder('가맹점명을 입력하세요').fill(CREATED_MERCHANT);
  await addDialog.locator('input[type="number"]').fill(String(EXPENSE_AMOUNT));
  await addDialog.getByRole('button', { name: '추가', exact: true }).click();

  const createdItem = page.getByTestId('expense-item').filter({
    hasText: CREATED_MERCHANT,
  });
  await expect(createdItem).toContainText('12,300원');

  let createdDocument: FirestoreDocument | undefined;
  await expect.poll(async () => {
    createdDocument = (await readExpenseDocuments(request)).find(
      (document) =>
        document.fields?.merchant?.stringValue === CREATED_MERCHANT
        && document.fields?.lifecycleState?.stringValue === 'active'
    );
    return createdDocument?.fields;
  }).toMatchObject({
    amount: { integerValue: String(EXPENSE_AMOUNT) },
    aggregateVersion: { integerValue: '1' },
    lifecycleState: { stringValue: 'active' },
  });
  const expenseId = documentId(createdDocument!);

  // A real Firestore trigger must finish the non-push manual origin normally.
  await expect.poll(async () => {
    const outbox = await readFirestoreCollection(request, 'outboxEvents');
    return outbox.find((document) =>
      document.fields?.aggregateId?.stringValue === expenseId
      && document.fields?.eventType?.stringValue === 'TransactionRecorded'
    )?.fields;
  }).toMatchObject({ notificationConsumerStatus: { stringValue: 'NoTarget' } });
  expect(await readFirestoreCollection(request, 'notificationDeliveries')).toEqual([]);

  // 실제 Client SDK로 돋보기 검색 원본을 읽고 결과까지 표시해야 합니다.
  await page.goto('/');
  await expect(calendar).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await page.getByPlaceholder('지출처명, 메모, 카드명을 검색해보세요').fill(CREATED_MERCHANT);
  await expect(page.getByText('1건 · 12,300원', { exact: true })).toBeVisible();
  await expect(page.getByLabel('검색 시작일')).toHaveCount(0);
  await expect(page.getByLabel('검색 종료일')).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: '검색 결과를 불러오지 못했습니다' })).toHaveCount(0);
  await page.getByRole('button', { name: '닫기', exact: true }).click();

  await page.goto('/stats');
  await expect(page.getByRole('heading', { name: '지출 통계', exact: true })).toBeVisible();
  await expect(page.getByText('12,300원', { exact: true }).first()).toBeVisible();
  // 빠른 Emulator 응답에도 중간 로딩 화면이 나타났다면 관측합니다.
  await page.evaluate(() => {
    const state = { loadingFrames: 0, observer: undefined as MutationObserver | undefined };
    state.observer = new MutationObserver(() => {
      if (document.body.textContent?.includes('로딩중...')) state.loadingFrames += 1;
    });
    state.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    (window as unknown as { statisticsTransition: typeof state }).statisticsTransition = state;
  });
  for (const period of ['3개월', '6개월', '1년', '3개월']) {
    await page.getByRole('button', { name: period, exact: true }).click();
    await expect(page.getByText('12,300원', { exact: true }).first()).toBeVisible();
  }
  const loadingFrames = await page.evaluate(() => {
    const state = (window as unknown as { statisticsTransition: { loadingFrames: number; observer: MutationObserver } }).statisticsTransition;
    state.observer.disconnect();
    return state.loadingFrames;
  });
  expect(loadingFrames).toBe(0);

  // 알림 클릭과 같은 full navigation 뒤에도 인증을 복원하고 해당 지출을 엽니다.
  await page.goto(`/expenses/${encodeURIComponent(expenseId)}/edit`);
  const editDialog = page.getByRole('dialog', { name: '지출 수정' });
  const merchantInput = editDialog.locator('input[type="text"]').first();
  await expect(editDialog).toBeVisible();
  await expect(merchantInput).toHaveValue(CREATED_MERCHANT);
  await merchantInput.fill(UPDATED_MERCHANT);
  await editDialog.getByRole('button', { name: '저장', exact: true }).click();

  await expect.poll(async () => (await findExpense(request, expenseId))?.fields)
    .toMatchObject({
      merchant: { stringValue: UPDATED_MERCHANT },
      aggregateVersion: { integerValue: '2' },
      lifecycleState: { stringValue: 'active' },
    });
  const updatedItem = page.getByTestId('expense-item').filter({
    hasText: UPDATED_MERCHANT,
  });
  await expect(updatedItem).toBeVisible();

  await updatedItem.click();
  await page
    .getByRole('dialog', { name: '지출 수정' })
    .getByRole('button', { name: '삭제', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: '지출 삭제' })
    .getByRole('button', { name: '삭제', exact: true })
    .click();

  await expect.poll(async () => (await findExpense(request, expenseId))?.fields)
    .toMatchObject({
      aggregateVersion: { integerValue: '3' },
      lifecycleState: { stringValue: 'deleted' },
    });
  await expect(updatedItem).toHaveCount(0);
  await expect(page.getByText('지출 내역이 없습니다', { exact: true })).toBeVisible();
  expect(browserErrors).toEqual([]);

  await test.step('모바일 실제 touch로 연속 저장하고 canonical·projection·새로고침 순서를 확인한다', async () => {
    const householdId = createdDocument!.fields?.householdId?.stringValue;
    expect(householdId).toBeDefined();
    const household = (await readFirestoreCollection(request, 'households'))
      .find((document) => documentId(document) === householdId);
    expect(household).toBeDefined();
    const initialCatalogVersion = Number(household!.fields?.categoryCatalogVersion?.integerValue);
    expect(initialCatalogVersion).toBeGreaterThan(0);

    const mobileContext = await browser.newContext({
      ...devices['Pixel 7'],
      baseURL: new URL(page.url()).origin,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });
    try {
      const mobilePage = await mobileContext.newPage();
      const mobileErrors: string[] = [];
      mobilePage.on('pageerror', (error) => mobileErrors.push(error.message));
      await mobilePage.goto('/');
      await mobilePage.getByRole('button', { name: '테스트 계정으로 로그인' }).click();
      await expect(mobilePage.locator('.calendar-glass')).toHaveAttribute('aria-busy', 'false');
      await mobilePage.goto('/settings');
      await mobilePage.getByRole('button', { name: /^카테고리\s*5개$/ }).click();

      const handles = mobilePage.getByTestId('category-order-list')
        .getByRole('button', { name: / 순서 이동$/ });
      const expectVisibleOrder = async (labels: string[]) => {
        await expect.poll(() => handles.evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute('aria-label'))
        )).toEqual(labels.map((label) => `${label} 순서 이동`));
      };
      await expectVisibleOrder(['생활비', '육아비', '고정비', '식비', '기타']);

      await mobilePage.evaluate(() => {
        type PointerSample = { type: string; pointerType: string; trusted: boolean };
        const samples: PointerSample[] = [];
        (window as unknown as { categoryPointerSamples: PointerSample[] }).categoryPointerSamples = samples;
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
          document.addEventListener(type, (event) => {
            const pointer = event as PointerEvent;
            if ((pointer.target as Element | null)?.closest('[data-category-id]')) {
              samples.push({ type, pointerType: pointer.pointerType, trusted: pointer.isTrusted });
            }
          }, true);
        }
      });
      const session = await mobileContext.newCDPSession(mobilePage);

      await dragCategoryByTouch(mobilePage, session, '생활비', '고정비');
      await expectVisibleOrder(['육아비', '고정비', '생활비', '식비', '기타']);
      await expectStoredCategoryOrder(request, householdId!,
        ['childcare', 'fixed', 'living', 'food', 'etc'], initialCatalogVersion + 1);

      // 새로고침 없이 다음 저장이 최신 catalogVersion으로 성공해야 합니다.
      await dragCategoryByTouch(mobilePage, session, '식비', '육아비');
      await expectVisibleOrder(['식비', '육아비', '고정비', '생활비', '기타']);
      await expectStoredCategoryOrder(request, householdId!,
        ['food', 'childcare', 'fixed', 'living', 'etc'], initialCatalogVersion + 2);

      const pointerSamples = await mobilePage.evaluate(() =>
        (window as unknown as {
          categoryPointerSamples: { type: string; pointerType: string; trusted: boolean }[];
        }).categoryPointerSamples
      );
      expect(pointerSamples.filter((event) => event.type === 'pointerdown')).toHaveLength(2);
      expect(pointerSamples.filter((event) => event.type === 'pointerup')).toHaveLength(2);
      expect(pointerSamples.some((event) => event.type === 'pointermove')).toBe(true);
      expect(pointerSamples.some((event) => event.type === 'pointercancel')).toBe(false);
      expect(pointerSamples.every((event) => event.pointerType === 'touch' && event.trusted)).toBe(true);
      await testInfo.attach('mobile-category-native-touch', {
        body: JSON.stringify(pointerSamples, null, 2),
        contentType: 'application/json',
      });

      await mobilePage.reload();
      await mobilePage.getByRole('button', { name: /^카테고리\s*5개$/ }).click();
      await expectVisibleOrder(['식비', '육아비', '고정비', '생활비', '기타']);
      await expectStoredCategoryOrder(request, householdId!,
        ['food', 'childcare', 'fixed', 'living', 'etc'], initialCatalogVersion + 2);
      expect(mobileErrors).toEqual([]);
      await mobilePage.getByTestId('category-order-list').scrollIntoViewIfNeeded();
      await mobilePage.screenshot({ path: testInfo.outputPath('category-reorder-mobile.png') });
    } finally {
      await mobileContext.close();
    }
  });
});
