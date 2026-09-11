import { expect, type APIRequestContext, type CDPSession, type Locator, type Page } from '@playwright/test';
import { createHouseholdThroughUi, readExpenseDocuments, readFirestoreCollection, type FirestoreDocument } from './emulator';

export const documentId = (document: FirestoreDocument): string => document.name.split('/').at(-1)!;
export const textField = (document: FirestoreDocument, key: string): string | undefined => document.fields?.[key]?.stringValue;
export const integerField = (document: FirestoreDocument, key: string): number => Number(document.fields?.[key]?.integerValue);

export async function dragCategoryByTouch(page: Page, session: CDPSession, sourceLabel: string, targetLabel: string, cancel = false): Promise<void> {
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
  const start = { x: sourceBox!.x + sourceBox!.width / 2, y: sourceBox!.y + sourceBox!.height / 2 };
  const end = { x: targetBox!.x + targetBox!.width / 2, y: targetBox!.y + targetBox!.height / 2 };
  // 브라우저 입력 경계에서 trusted touch를 보내 실제 PointerCapture/스크롤을 거칩니다.
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
  for (let step = 1; step <= 8; step += 1) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8, id: 1 }] });
  }
  await expect.poll(() => source.evaluate(button => getComputedStyle(button.closest('[data-category-id]')!).transform)).not.toBe('none');
  await session.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
}

export async function expectStoredCategoryOrder(request: APIRequestContext, householdId: string, keys: string[], version: number): Promise<void> {
  await expect.poll(async () => {
    const [canonical, projection, settings, households] = await Promise.all([
      readFirestoreCollection(request, `households/${householdId}/categories`),
      readFirestoreCollection(request, 'categories'),
      readFirestoreCollection(request, `households/${householdId}/categorySettings`),
      readFirestoreCollection(request, 'households'),
    ]);
    return {
      canonical: canonical.filter(doc => textField(doc, 'state') === 'active').sort((left, right) => integerField(left, 'sortOrder') - integerField(right, 'sortOrder')).map(doc => textField(doc, 'categoryId')),
      projection: projection.filter(doc => textField(doc, 'householdId') === householdId && doc.fields?.isActive?.booleanValue).sort((left, right) => integerField(left, 'order') - integerField(right, 'order')).map(doc => textField(doc, 'key')),
      catalogVersion: integerField(settings.find(doc => documentId(doc) === 'default')!, 'catalogVersion'),
      householdVersion: integerField(households.find(doc => documentId(doc) === householdId)!, 'categoryCatalogVersion'),
    };
  }).toEqual({ canonical: keys, projection: keys, catalogVersion: version, householdVersion: version });
}

export function seoulDate(monthOffset = 0, day = 15): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const year = Number(parts.find(part => part.type === 'year')!.value);
  const month = Number(parts.find(part => part.type === 'month')!.value);
  const date = new Date(Date.UTC(year, month - 1 + monthOffset, day));
  return date.toISOString().slice(0, 10);
}

/** 로그인·온보딩·기본 카테고리는 실제 UI와 인증된 운영 Command로 생성합니다. */
export async function createFinanceHousehold(page: Page, request: APIRequestContext): Promise<string> {
  const household = await createHouseholdThroughUi(page, '재무 E2E 가구', '재무 테스터');
  expect(await readFirestoreCollection(request, 'households')).toHaveLength(1);
  return household.householdId;
}

export async function openAddTransaction(page: Page, type: 'expense' | 'income' = 'expense'): Promise<Locator> {
  await page.goto(type === 'income' ? '/income' : '/');
  await expect(page.locator('.calendar-glass')).toHaveAttribute('aria-busy', 'false');
  await page.getByTestId(/^calendar-day-/).first().click();
  await page.getByRole('button', { name: type === 'income' ? '수입 추가' : '지출 추가', exact: true }).click();
  return page.getByRole('dialog', { name: type === 'income' ? '수입 추가' : '지출 추가', exact: true });
}

export async function addExpenseThroughUi(page: Page, request: APIRequestContext, input: {
  merchant: string; amount: number; date?: string; memo?: string; category?: string;
}): Promise<FirestoreDocument> {
  const dialog = await openAddTransaction(page);
  await dialog.getByPlaceholder('가맹점명을 입력하세요').fill(input.merchant);
  await dialog.locator('input[type="number"]').fill(String(input.amount));
  await dialog.locator('input[type="date"]').fill(input.date ?? seoulDate());
  if (input.memo !== undefined) await dialog.getByPlaceholder('메모를 입력하세요').fill(input.memo);
  if (input.category) await dialog.getByRole('button', { name: input.category.slice(0, 2), exact: true }).click();
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  return waitForExpense(request, input.merchant);
}

export async function waitForExpense(request: APIRequestContext, merchant: string): Promise<FirestoreDocument> {
  let document: FirestoreDocument | undefined;
  await expect.poll(async () => {
    document = (await readExpenseDocuments(request)).find(doc => textField(doc, 'merchant') === merchant && textField(doc, 'lifecycleState') === 'active');
    return document !== undefined;
  }).toBe(true);
  return document!;
}

export async function findExpense(request: APIRequestContext, id: string): Promise<FirestoreDocument | undefined> {
  return (await readExpenseDocuments(request)).find(doc => documentId(doc) === id);
}

export async function openExpenseEdit(page: Page, id: string): Promise<Locator> {
  const target = await findExpense(page.request, id);
  expect(target, `수정 대상 ${id}`).toBeDefined();
  if (textField(target!, 'date')?.slice(0, 7) === seoulDate().slice(0, 7)) {
    await page.goto(`/expenses/${encodeURIComponent(id)}/edit`);
  } else {
    // 과거월은 검색 결과의 실제 편집 경로를 사용합니다.
    // 직접 알림 딥링크의 과거월 이동은 notification-deeplink가 검증합니다.
    await page.goto('/');
    await page.getByRole('button', { name: '검색', exact: true }).click();
    const input = page.getByPlaceholder('지출처명, 메모, 카드명을 검색해보세요');
    await input.fill(textField(target!, 'merchant')!);
    const search = page.locator('div.fixed').filter({ has: input });
    await search.getByText(textField(target!, 'merchant')!, { exact: true }).click();
  }
  const dialog = page.getByRole('dialog', { name: '지출 수정', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function openCategorySettings(page: Page): Promise<Locator> {
  await page.goto('/settings');
  await page.getByRole('button', { name: /^카테고리\s*\d+개$/ }).click();
  return page.getByTestId('category-order-list');
}

export async function addCategoryThroughUi(page: Page, request: APIRequestContext, label: string, budget?: number): Promise<FirestoreDocument> {
  await openCategorySettings(page);
  await page.getByRole('button', { name: '새 카테고리 추가', exact: true }).click();
  await page.getByPlaceholder('카테고리명').fill(label);
  if (budget !== undefined) await page.getByPlaceholder('예산 없음').fill(String(budget));
  await page.getByRole('button', { name: '추가', exact: true }).click();
  let category: FirestoreDocument | undefined;
  await expect.poll(async () => {
    category = (await readFirestoreCollection(request, 'categories')).find(doc => textField(doc, 'label') === label && doc.fields?.isActive?.booleanValue);
    return category !== undefined;
  }).toBe(true);
  return category!;
}

/** 브라우저가 실제 계산한 geometry와 hit testing으로 잘림을 확인합니다. */
export async function expectInsideViewport(locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const geometry = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const center = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { left: rect.left, right: rect.right, viewport: window.innerWidth, hit: center === element || element.contains(center) };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.hit).toBe(true);
}
