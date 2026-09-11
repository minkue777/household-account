import { expect, test } from '@playwright/test';
import { firestoreFields, readExpenseDocuments, resetTestAccount, writeFirestoreFixture } from './emulator';
import { addCategoryThroughUi, addExpenseThroughUi, createFinanceHousehold, documentId, seoulDate } from './finance-helpers';

test.beforeEach(async () => { await resetTestAccount(); });

test('[T-SEA-001][SEA-001][SEA-002][SEA-004][SEA-005] 전체기간 검색은 과거 가맹점·메모·카드 별칭·마스킹과 월별 합계를 실제 SDK로 읽는다', async ({ page, request }) => {
  await createFinanceHousehold(page, request);
  const newest = await addExpenseThroughUi(page, request, { merchant: '공통 카페 현재', amount: 3000, memo: '구독영수증', date: seoulDate() });
  await addExpenseThroughUi(page, request, { merchant: '공통 카페 과거', amount: 4500, memo: '출장영수증', date: '2020-02-13' });
  // 카드 수집 경계는 별도 ingestion E2E가 담당합니다. 이 fixture는 생성 당시
  // 저장되는 카드 증거를 입력으로 삼아 실제 공개 Query/SDK/검색 UI를 검증합니다.
  await writeFirestoreFixture(request, `expenses/${documentId(newest)}`, {
    ...newest.fields!, cardType: { stringValue: 'card' }, cardDisplay: { stringValue: '국민카드(2972)' },
    cardEvidence: { stringValue: '국민카드(2972)' }, cardLastFour: { stringValue: '2972' },
  });
  await page.goto('/');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  const input = page.getByPlaceholder('지출처명, 메모, 카드명을 검색해보세요');
  const search = page.locator('div.fixed').filter({ has: input });
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await input.fill('공통 카페');
  await expect(page.getByText('2건 · 7,500원', { exact: true })).toBeVisible();
  const monthHeaders = page.getByRole('button').filter({ hasText: /^\d{4}년 \d+월.*건/ });
  await expect(monthHeaders).toHaveCount(2);
  await expect(monthHeaders.nth(0)).toContainText(`${seoulDate().slice(0, 4)}년 ${Number(seoulDate().slice(5, 7))}월`);
  await expect(monthHeaders.nth(1)).toContainText('2020년 2월');
  await expect(monthHeaders.nth(1)).toContainText('4,500원');
  await monthHeaders.nth(1).click();
  await expect(search.getByText('공통 카페 과거', { exact: true })).toBeVisible();
  for (const keyword of ['구독영수증', '국민', 'KB', '2972', '국민카드(2972)', '국민카드(29**)', '국민카드(29xx)']) {
    await input.fill(keyword);
    await expect(page.getByText('1건 · 3,000원', { exact: true })).toBeVisible();
    await expect(search.getByText('공통 카페 현재', { exact: true })).toBeVisible();
  }
  await input.fill('국민카드(3972)');
  await expect(page.getByText('"국민카드(3972)"에 대한 검색 결과가 없습니다.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '검색어 지우기' }).click();
  await expect(input).toHaveValue('');
  await expect(page.getByText('2건 · 7,500원', { exact: true })).toHaveCount(0);
  await expect(page.locator('p[role="alert"]')).toHaveCount(0);
});

test('[T-SEA-002][SEA-001][SEA-003] 검색 결과 편집 후 합계가 갱신되고 검색어를 바꾸면 이전 결과가 남지 않는다', async ({ page, request }) => {
  await createFinanceHousehold(page, request);
  await addExpenseThroughUi(page, request, { merchant: '검색에서 수정', amount: 3000 });
  await page.goto('/');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  const input = page.getByPlaceholder('지출처명, 메모, 카드명을 검색해보세요');
  const search = page.locator('div.fixed').filter({ has: input });
  await input.fill('검색에서');
  await search.getByText('검색에서 수정', { exact: true }).click();
  const edit = page.getByRole('dialog', { name: '지출 수정' });
  await edit.locator('input[type="number"]').fill('7200');
  await edit.getByPlaceholder('메모를 입력하세요').fill('새 검색어');
  await edit.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByText('1건 · 7,200원', { exact: true })).toBeVisible();
  await input.fill('없는 거래');
  await expect(page.getByText('"없는 거래"에 대한 검색 결과가 없습니다.', { exact: true })).toBeVisible();
  await expect(search.getByText('검색에서 수정', { exact: true })).toHaveCount(0);
  await input.fill('새 검색어');
  await expect(page.getByText('1건 · 7,200원', { exact: true })).toBeVisible();
});

test('[T-SEA-002][T-SEA-003][SEA-003][SEA-004] 검색 51건은 50건 첫 페이지에서도 전체 합계를 유지하고 다음 페이지에서 누락 없이 표시한다', async ({ page, request }) => {
  const householdId = await createFinanceHousehold(page, request);
  // 이 테스트의 입력은 과거에 저장된 원장입니다. 생성 API를 대체하지 않고
  // 실제 Read Contract·페이지 경계·UI 총합만 검증합니다.
  for (let offset = 0; offset < 51; offset += 10) {
    await Promise.all(Array.from({ length: Math.min(10, 51 - offset) }, (_, index) => {
      const number = offset + index + 1;
      return writeFirestoreFixture(request, `expenses/search-page-${String(number).padStart(3, '0')}`, firestoreFields({
        householdId, merchant: `페이지 거래 ${String(number).padStart(3, '0')}`, amount: 100,
        category: 'etc', date: '2020-01-15', time: '12:00', transactionType: 'expense', lifecycleState: 'active', aggregateVersion: 1,
      }));
    }));
  }
  await page.goto('/');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  const input = page.getByPlaceholder('지출처명, 메모, 카드명을 검색해보세요');
  const search = page.locator('div.fixed').filter({ has: input });
  await input.fill('페이지 거래');
  await expect(search.getByText('51건 · 5,100원', { exact: true })).toBeVisible();
  await expect(search.getByText(/^페이지 거래 \d{3}$/)).toHaveCount(50);
  await expect(search.getByText('페이지 거래 001', { exact: true })).toHaveCount(0);
  await search.getByRole('button', { name: '이전 거래에서 더 검색' }).click();
  await expect(search.getByText(/^페이지 거래 \d{3}$/)).toHaveCount(51);
  await expect(search.getByText('페이지 거래 001', { exact: true })).toBeVisible();
  await expect(search.getByText('51건 · 5,100원', { exact: true })).toBeVisible();
  await expect(search.getByRole('button', { name: '이전 거래에서 더 검색' })).toHaveCount(0);
});

test('[T-LED-009][STAT-001][STAT-002][STAT-003][LED-006] 3·6·12개월과 지정 기간은 서로 다른 실제 합계를 표시하며 차트와 카테고리 선택이 작동한다', async ({ page, request }) => {
  await createFinanceHousehold(page, request);
  for (const [offset, amount] of [[0, 1100], [-2, 2200], [-5, 4400], [-11, 8800], [-13, 17600]]) {
    await addExpenseThroughUi(page, request, { merchant: `통계 ${offset}개월`, amount, date: seoulDate(offset), category: '식비' });
  }
  await page.goto('/stats');
  const total = page.locator('span.text-xl.font-bold');
  await expect(total).toHaveText('16,500원');
  for (const [period, expected] of [['3개월', '3,300원'], ['6개월', '7,700원'], ['1년', '16,500원'], ['3개월', '3,300원']]) {
    await page.getByRole('button', { name: period, exact: true }).click();
    await expect(total).toHaveText(expected);
    await expect(page.locator('canvas')).toHaveCount(2);
    await expect(page.getByRole('button', { name: new RegExp(`식비.*${expected}.*100%`) })).toBeVisible();
  }
  for (const label of ['생활비', '육아비', '식비']) await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '식비', exact: true }).click();
  await expect(page.getByRole('button', { name: '식비', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(total).toHaveText('3,300원');
  await page.getByRole('button', { name: '직접 선택', exact: true }).click();
  await page.getByLabel('시작 월').fill(seoulDate(-13).slice(0, 7));
  await page.getByLabel('종료 월').fill(seoulDate(-13).slice(0, 7));
  await expect(total).toHaveText('17,600원');
  await page.getByLabel('시작 월').fill(seoulDate().slice(0, 7));
  await expect(page.locator('p[role="alert"]')).toHaveText('시작 월은 종료 월보다 늦을 수 없습니다.');
  await expect(page.getByText('17,600원', { exact: true })).toHaveCount(0);
});

test('[STAT-003][STAT-004] 예산 카테고리만 추이 기본값으로 선택되고 통계 상세 편집·삭제가 합계를 변경한다', async ({ page, request }) => {
  await createFinanceHousehold(page, request);
  await addCategoryThroughUi(page, request, '취미활동', 20000);
  await addExpenseThroughUi(page, request, { merchant: '통계 상세 수정', amount: 7000, category: '취미활동' });
  await page.goto('/stats');
  await expect(page.getByRole('button', { name: '취미활동', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '식비', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: /취미활동.*7,000원/ }).click();
  await page.getByText('통계 상세 수정', { exact: true }).click();
  let edit = page.getByRole('dialog', { name: '지출 수정' });
  await edit.locator('input[type="number"]').fill('9000');
  await edit.getByRole('button', { name: '식비', exact: true }).click();
  await edit.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator('span.text-xl.font-bold')).toHaveText('9,000원');
  await page.getByRole('button', { name: /식비.*9,000원/ }).click();
  await page.getByText('통계 상세 수정', { exact: true }).click();
  edit = page.getByRole('dialog', { name: '지출 수정' });
  await edit.getByRole('button', { name: '삭제', exact: true }).click();
  await page.getByRole('dialog', { name: '지출 삭제' }).getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByText('데이터 없음', { exact: true })).toBeVisible();
  expect((await readExpenseDocuments(request)).filter(document => document.fields?.lifecycleState?.stringValue === 'active')).toHaveLength(0);
});
