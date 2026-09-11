import { devices, expect, test } from '@playwright/test';
import { readFirestoreCollection, resetTestAccount } from './emulator';
import { addCategoryThroughUi, addExpenseThroughUi, createFinanceHousehold, documentId, dragCategoryByTouch, expectInsideViewport, expectStoredCategoryOrder, findExpense, integerField, openAddTransaction, openCategorySettings, openExpenseEdit, textField } from './finance-helpers';

test.beforeEach(async () => { await resetTestAccount(); });

test('[T-CAT-007][CAT-002] 모바일 실제 touch로 연속 순서를 저장하고 취소한 드래그는 저장하지 않는다', async ({ page, browser, request }, testInfo) => {
  const householdId = await createFinanceHousehold(page, request);
  const household = (await readFirestoreCollection(request, 'households')).find(doc => documentId(doc) === householdId)!;
  const version = integerField(household, 'categoryCatalogVersion');
  const mobileContext = await browser.newContext({ ...devices['Pixel 7'], baseURL: new URL(page.url()).origin, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  try {
    const mobile = await mobileContext.newPage();
    await mobile.goto('/');
    await mobile.getByRole('button', { name: '테스트 계정으로 로그인' }).click();
    await expect(mobile.locator('.calendar-glass')).toHaveAttribute('aria-busy', 'false');
    const list = await openCategorySettings(mobile);
    const handles = list.getByRole('button', { name: / 순서 이동$/ });
    await expect(handles).toHaveText(['생활', '육아', '고정', '식비', '기타']);
    await mobile.evaluate(() => {
      const events: { type: string; pointerType: string; trusted: boolean }[] = [];
      (window as unknown as { financeTouchEvents: typeof events }).financeTouchEvents = events;
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
        document.addEventListener(type, event => {
          const pointer = event as PointerEvent;
          if ((pointer.target as Element | null)?.closest('[data-category-id]')) events.push({ type, pointerType: pointer.pointerType, trusted: pointer.isTrusted });
        }, true);
      }
    });
    const session = await mobileContext.newCDPSession(mobile);
    const reorderRequests: unknown[] = [];
    mobile.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/executeHouseholdCommand')) {
        const envelope = request.postDataJSON()?.data;
        if (envelope?.command === 'category.reorder.v1') reorderRequests.push(envelope);
      }
    });
    await dragCategoryByTouch(mobile, session, '생활비', '고정비');
    await expect(handles).toHaveText(['육아', '고정', '생활', '식비', '기타']);
    await expectStoredCategoryOrder(request, householdId, ['childcare', 'fixed', 'living', 'food', 'etc'], version + 1);
    await dragCategoryByTouch(mobile, session, '식비', '육아비');
    await expect(handles).toHaveText(['식비', '육아', '고정', '생활', '기타']);
    await expectStoredCategoryOrder(request, householdId, ['food', 'childcare', 'fixed', 'living', 'etc'], version + 2);
    await dragCategoryByTouch(mobile, session, '식비', '고정비', true);
    await expect(handles).toHaveText(['식비', '육아', '고정', '생활', '기타']);
    await expect.poll(() => handles.first().evaluate(button => getComputedStyle(button.closest('[data-category-id]')!).transform)).toBe('none');
    expect(reorderRequests).toHaveLength(2);
    const samples = await mobile.evaluate(() => (window as unknown as { financeTouchEvents: { type: string; pointerType: string; trusted: boolean }[] }).financeTouchEvents);
    expect(samples.filter(event => event.type === 'pointerdown')).toHaveLength(3);
    expect(samples.filter(event => event.type === 'pointerup')).toHaveLength(2);
    expect(samples.filter(event => event.type === 'pointercancel')).toHaveLength(1);
    expect(samples.some(event => event.type === 'pointermove')).toBe(true);
    expect(samples.every(event => event.pointerType === 'touch' && event.trusted)).toBe(true);
    await testInfo.attach('category-native-touch', { body: JSON.stringify(samples), contentType: 'application/json' });
    await mobile.reload();
    await mobile.getByRole('button', { name: /^카테고리\s*5개$/ }).click();
    await expect(handles).toHaveText(['식비', '육아', '고정', '생활', '기타']);
    await expectStoredCategoryOrder(request, householdId, ['food', 'childcare', 'fixed', 'living', 'etc'], version + 2);
  } finally { await mobileContext.close(); }
});

test('[CAT-001][CAT-002] 모바일 카테고리 추가·16색 선택은 잘리지 않고 이름·색상·예산이 새로고침 뒤 유지된다', async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const householdId = await createFinanceHousehold(page, request);
  const list = await openCategorySettings(page);
  await expect(list.getByRole('button', { name: / 순서 이동$/ })).toHaveText(['생활', '육아', '고정', '식비', '기타']);
  const settings = await readFirestoreCollection(request, `households/${householdId}/categorySettings`);
  expect(textField(settings[0], 'defaultCategoryId')).toBe('etc');
  await page.getByRole('button', { name: '새 카테고리 추가', exact: true }).click();
  await expectInsideViewport(page.getByPlaceholder('카테고리명'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: '카테고리 색상 선택', exact: true }).click();
  const palette = page.locator('button[aria-pressed]');
  await expect(palette).toHaveCount(16);
  expect(new Set(await palette.evaluateAll(buttons => buttons.map(button => getComputedStyle(button).backgroundColor))).size).toBe(16);
  for (let index = 0; index < 16; index += 1) await expectInsideViewport(palette.nth(index));
  await page.getByRole('button', { name: '베이지', exact: true }).click();
  await page.getByPlaceholder('카테고리명').fill('간식/디저트/커피');
  await page.getByPlaceholder('예산 없음').fill('50000');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  const row = list.locator('[data-category-id]').filter({ hasText: '간식/디저트/커피' });
  await expect(row).toContainText('월 예산: 50,000원');
  await expect(row.getByRole('button', { name: '간식/디저트/커피 순서 이동' })).toHaveCSS('background-color', 'rgb(203, 170, 145)');
  await page.reload();
  await page.getByRole('button', { name: /^카테고리\s*6개$/ }).click();
  await row.getByRole('button', { name: '간식/디저트/커피 수정' }).click();
  await page.getByPlaceholder('카테고리명').fill('간식과 커피');
  await page.getByPlaceholder('예산 없음').fill('60000');
  await page.getByRole('button', { name: '카테고리 색상 선택' }).click();
  await page.getByRole('button', { name: '살구', exact: true }).click();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(list.locator('[data-category-id]').filter({ hasText: '간식과 커피' })).toContainText('월 예산: 60,000원');
  await expect.poll(async () => (await readFirestoreCollection(request, 'categories')).find(doc => textField(doc, 'label') === '간식과 커피')?.fields)
    .toMatchObject({ color: { stringValue: '#FDBA74' }, budget: { integerValue: '60000' }, isActive: { booleanValue: true } });
});

test('[CAT-002][CAT-003] 기본 카테고리가 새 등록에 적용되고 보관된 카테고리는 과거 거래를 보존하며 신규 선택에서 제외된다', async ({ page, request }) => {
  await createFinanceHousehold(page, request);
  const custom = await addCategoryThroughUi(page, request, '여행비');
  const oldExpense = await addExpenseThroughUi(page, request, { merchant: '기존 여행', amount: 9000, category: '여행비' });
  const list = await openCategorySettings(page);
  const foodRow = list.locator('[data-category-id]').filter({ has: page.getByRole('button', { name: '식비 순서 이동', exact: true }) });
  await foodRow.getByTitle('기본 카테고리로 설정').click();
  await expect(foodRow.getByText('기본', { exact: true })).toBeVisible();
  const add = await openAddTransaction(page);
  await expect(add.getByRole('button', { name: '식비', exact: true })).toHaveClass(/border-blue-500/);
  await add.getByRole('button', { name: '취소', exact: true }).click();
  await openCategorySettings(page);
  await page.getByRole('button', { name: '여행비 삭제', exact: true }).click();
  await page.getByRole('dialog', { name: '카테고리 삭제' }).getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByRole('button', { name: '여행비 순서 이동' })).toHaveCount(0);
  await expect.poll(async () => (await readFirestoreCollection(request, 'categories')).find(doc => documentId(doc) === documentId(custom))?.fields?.isActive?.booleanValue).toBe(false);
  expect(textField((await findExpense(request, documentId(oldExpense)))!, 'category')).toBe(textField(custom, 'key'));
  const edit = await openExpenseEdit(page, documentId(oldExpense));
  await expect(edit.getByRole('button', { name: '여행', exact: true })).toHaveCount(0);
  await edit.getByRole('button', { name: '닫기', exact: true }).click();
  await page.goto('/stats');
  await expect(page.getByRole('button', { name: /여행비.*9,000원/ })).toBeVisible();
});

test('[T-LED-009][T-BUD-001][BUD-001][BUD-002] 예산 있는 지출만 잔여 예산에서 차감하고 예산 없는 지출도 월 합계에 포함한다', async ({ page, request }) => {
  await createFinanceHousehold(page, request);
  await addCategoryThroughUi(page, request, '식재료', 10000);
  await addExpenseThroughUi(page, request, { merchant: '예산 지출', amount: 12000, category: '식재료' });
  await addExpenseThroughUi(page, request, { merchant: '예산 없는 지출', amount: 7000, category: '기타' });
  await page.goto('/');
  const remaining = page.locator('.balance-card-glass').filter({ hasText: /잔여 예산/ });
  await expect(remaining).toContainText('-2,000');
  await expect(page.locator('.balance-card-glass').filter({ hasText: /월 지출/ })).toContainText('19,000');
  await expect(page.getByText('(120%)', { exact: true })).toBeVisible();
  await expect(page.getByText('예산 초과 2,000원', { exact: true })).toBeVisible();
  await expect(page.getByText('(--)', { exact: true })).toBeVisible();
});

test('[CAT-002][CAT-003] 기본 카테고리 삭제와 음수 예산은 실제 서버에서 거부되어 카탈로그가 보존된다', async ({ page, request }) => {
  const householdId = await createFinanceHousehold(page, request);
  await openCategorySettings(page);
  const before = await readFirestoreCollection(request, `households/${householdId}/categories`);
  await page.getByRole('button', { name: '기타 삭제', exact: true }).click();
  await page.getByRole('dialog', { name: '카테고리 삭제' }).getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '카테고리 변경 실패' })).toBeVisible();
  expect(await readFirestoreCollection(request, `households/${householdId}/categories`)).toEqual(before);
  await page.reload();
  await page.getByRole('button', { name: /^카테고리\s*5개$/ }).click();
  await page.getByRole('button', { name: '새 카테고리 추가', exact: true }).click();
  await page.getByPlaceholder('카테고리명').fill('음수 예산');
  await page.getByPlaceholder('예산 없음').fill('-1');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '카테고리 변경 실패' })).toBeVisible();
  expect(await readFirestoreCollection(request, `households/${householdId}/categories`)).toEqual(before);
});
