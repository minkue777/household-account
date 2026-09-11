import { expect, test } from '@playwright/test';
import { readFirestoreCollection, resetTestAccount, writeFirestoreFixture } from './emulator';
import { addCategoryThroughUi, addExpenseThroughUi, createFinanceHousehold, documentId, openCategorySettings, textField } from './finance-helpers';

test.beforeEach(async () => { await resetTestAccount(); });

test('[BAL-003][BAL-004][LED-010][HOME-002] 지역화폐 잔액은 유형별 서버 갱신을 반영하고 선택 유형 지출만 상세에 표시한다', async ({ page, request }) => {
  const householdId = await createFinanceHousehold(page, request);
  const gyeonggi = await addExpenseThroughUi(page, request, { merchant: '경기 결제', amount: 3000 });
  const daejeon = await addExpenseThroughUi(page, request, { merchant: '대전 결제', amount: 5000 });
  await addExpenseThroughUi(page, request, { merchant: '유형 없는 결제', amount: 7000 });
  // 수집된 유형 metadata와 Canonical 잔액을 준비합니다. 실제 capture→balance
  // 쓰기 경계는 ingestion integration에서 검증하며 아래 테스트는 실제 read/UI입니다.
  for (const [document, type] of [[gyeonggi, 'gyeonggi'], [daejeon, 'daejeon']] as const) {
    await writeFirestoreFixture(request, `expenses/${documentId(document)}`, { ...document.fields!, localCurrencyType: { stringValue: type } });
  }
  await writeFirestoreFixture(request, `households/${householdId}/homePreferences/home`, {
    left: { stringValue: 'MONTHLY_EXPENSE' }, right: { stringValue: 'LOCAL_CURRENCY_BALANCE' }, aggregateVersion: { integerValue: '1' },
  });
  await writeFirestoreFixture(request, `households/${householdId}/localCurrencyBalances/gyeonggi`, {
    localCurrencyType: { stringValue: 'gyeonggi' }, balanceInWon: { integerValue: '25000' },
  });
  await page.goto('/');
  const balance = page.locator('.balance-card-glass').filter({ hasText: '지역화폐 잔액' });
  await expect(balance).toContainText('25,000');
  await writeFirestoreFixture(request, `households/${householdId}/localCurrencyBalances/gyeonggi`, {
    localCurrencyType: { stringValue: 'gyeonggi' }, balanceInWon: { integerValue: '27000' },
  });
  await expect(balance).toContainText('27,000');
  await balance.click();
  const detail = page.locator('div.fixed').filter({ has: page.getByRole('heading', { name: '지역화폐 지출내역' }) });
  await expect(detail.getByRole('heading', { name: '지역화폐 지출내역' })).toBeVisible();
  await expect(detail.getByText('경기 결제', { exact: true })).toBeVisible();
  await expect(detail.getByText('대전 결제', { exact: true })).toHaveCount(0);
  await expect(detail.getByText('유형 없는 결제', { exact: true })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: '전체', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await writeFirestoreFixture(request, `households/${householdId}/localCurrencyBalances/daejeon`, {
    localCurrencyType: { stringValue: 'daejeon' }, balanceInWon: { integerValue: '19000' },
  });
  await expect(balance).toContainText('데이터 없음');
  await writeFirestoreFixture(request, `households/${householdId}/homePreferences/home`, {
    left: { stringValue: 'MONTHLY_EXPENSE' }, right: { stringValue: 'LOCAL_CURRENCY_BALANCE' },
    selectedLocalCurrencyType: { stringValue: 'daejeon' }, aggregateVersion: { integerValue: '2' },
  });
  await expect(balance).toContainText('19,000');
  await balance.click();
  await expect(detail.getByText('대전 결제', { exact: true })).toBeVisible();
  await expect(detail.getByText('경기 결제', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await writeFirestoreFixture(request, `households/${householdId}/localCurrencyBalances/daejeon`, {
    localCurrencyType: { stringValue: 'daejeon' }, balanceInWon: { integerValue: '-250' },
  });
  await expect(balance).toContainText('-250');
  await page.reload();
  await expect(balance).toContainText('-250');
});

test('[REC-001][REC-006] 정기지출 생성·수정·비활성·재활성·삭제는 실제 서버에 저장되고 최초 등록자를 유지한다', async ({ page, request }) => {
  const householdId = await createFinanceHousehold(page, request);
  await page.goto('/settings');
  await page.getByRole('button', { name: /^정기 지출\s*0개$/ }).click();
  await page.getByRole('button', { name: '새 정기 지출 추가', exact: true }).click();
  await page.getByPlaceholder('예: 삼성생명').fill('정기 보험료');
  await page.getByPlaceholder('50000').fill('51000');
  await page.getByPlaceholder('15').fill('31');
  await page.getByRole('button', { name: '고정비', exact: true }).click();
  await page.getByPlaceholder('예: 보험료').fill('자동 납부');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await expect(page.getByText('매월 31일 · 51,000원', { exact: true })).toBeVisible();
  const plans = await readFirestoreCollection(request, `households/${householdId}/recurringPlans`);
  expect(plans).toHaveLength(1);
  const planId = documentId(plans[0]);
  const creator = textField(plans[0], 'creatorMemberId');
  expect(creator).toBeTruthy();
  await page.getByRole('button', { name: '정기 보험료 정기 지출 수정' }).click();
  await page.getByPlaceholder('50000').fill('62000');
  await page.getByPlaceholder('15').fill('15');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByText('매월 15일 · 62,000원', { exact: true })).toBeVisible();
  await page.getByTitle('비활성화', { exact: true }).click();
  await expect(page.getByText('비활성', { exact: true })).toBeVisible();
  await page.getByTitle('활성화', { exact: true }).click();
  await expect(page.getByText('비활성', { exact: true })).toHaveCount(0);
  const updated = (await readFirestoreCollection(request, `households/${householdId}/recurringPlans`)).find(doc => documentId(doc) === planId)!;
  expect(textField(updated, 'creatorMemberId')).toBe(creator);
  await page.reload();
  await page.getByRole('button', { name: /^정기 지출\s*1개$/ }).click();
  await expect(page.getByText('매월 15일 · 62,000원', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '정기 보험료 정기 지출 삭제' }).click();
  await page.getByRole('dialog', { name: '정기 지출 삭제' }).getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByText('등록된 정기 지출이 없습니다.', { exact: true })).toBeVisible();
  await expect.poll(async () => (await readFirestoreCollection(request, 'recurring_expenses')).length).toBe(0);
});

test('[REC-005][CAT-002][CAT-003] 카테고리 보관은 비활성 정기지출 참조도 기본 카테고리로 변경한다', async ({ page, request }) => {
  await createFinanceHousehold(page, request);
  const custom = await addCategoryThroughUi(page, request, '문화비');
  await page.goto('/settings');
  await page.getByRole('button', { name: /^정기 지출\s*0개$/ }).click();
  await page.getByRole('button', { name: '새 정기 지출 추가', exact: true }).click();
  await page.getByPlaceholder('예: 삼성생명').fill('문화 구독료');
  await page.getByPlaceholder('50000').fill('5500');
  await page.getByPlaceholder('15').fill('15');
  await page.getByRole('button', { name: '문화비', exact: true }).click();
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByTitle('비활성화', { exact: true }).click();
  await expect(page.getByText('비활성', { exact: true })).toBeVisible();
  const existing = (await readFirestoreCollection(request, 'recurring_expenses'))[0];
  expect(textField(existing, 'category')).toBe(textField(custom, 'key'));
  await openCategorySettings(page);
  await page.getByRole('button', { name: '문화비 삭제' }).click();
  await page.getByRole('dialog', { name: '카테고리 삭제' }).getByRole('button', { name: '삭제', exact: true }).click();
  await expect.poll(async () => (await readFirestoreCollection(request, 'recurring_expenses'))[0]?.fields).toMatchObject({ category: { stringValue: 'etc' }, isActive: { booleanValue: false } });
  await page.reload();
  await page.getByRole('button', { name: /^정기 지출\s*1개$/ }).click();
  await expect(page.getByText('문화 구독료', { exact: true })).toBeVisible();
  await expect(page.getByText('비활성', { exact: true })).toBeVisible();
});
