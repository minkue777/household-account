import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import {
  createEmulatorAccount, createHouseholdThroughUi, E2E_PROJECT_ID, executeHouseholdCommand,
  firestoreFields, readFirestoreCollection, resetTestAccount,
} from '../e2e/emulator';
import { seoulDate } from '../e2e/finance-helpers';

export interface PerformanceFixture {
  householdId: string;
  targetId: string;
  targetMerchant: string;
  targetDate: string;
  targetAmount: number;
  monthTotals: number[];
  totalExpenseAmount: number;
  stockAssetId: string;
  assetTotal: number;
  today: string;
  firstSnapshotDate: string;
  snapshotCount: number;
  categories: { food: string; other: string };
}

const DATABASE = `projects/${E2E_PROJECT_ID}/databases/(default)`;
const DAY = 86_400_000;
export const FIXTURE_MONTHS = 36;
export const EXPENSES_PER_MONTH = 60;
export const ASSET_COUNT = 12;
export const STOCK_COUNT = 20;
export const LOCAL_CURRENCY_BALANCE = 25789;
export const DAILY_ASSET_CHANGE = 1000;

/** 외부 종목 카탈로그 URL만 테스트 서버의 실제 HTTP endpoint로 전환합니다.
 * WebKit의 활성 worker 요청은 context.route 대상이 아니므로 라우팅 대역을 사용하지 않습니다.
 * SDK 요청/응답 처리·제품 worker·gzip/hash·IndexedDB·브라우저 HTTP cache는 실제 경로입니다. */
export async function installCatalogFixture(context: BrowserContext): Promise<void> {
  function redirectCatalogTransport() {
    const state = window as typeof window & { performanceCatalogTransportInstalled?: boolean };
    if (state.performanceCatalogTransportInstalled) return;
    state.performanceCatalogTransportInstalled = true;
    const original = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (...args: [method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null]) {
      const url = new URL(String(args[1]), location.href);
      const object = decodeURIComponent(url.pathname).split('/o/')[1];
      if (url.protocol === 'https:' && url.hostname === 'firebasestorage.googleapis.com'
        && object?.startsWith('market-catalog/v1/')) {
        args[1] = `${location.origin}/__performance/catalog/${encodeURIComponent(object)}${url.search}`;
      }
      Reflect.apply(original, this, args);
    };
  }
  await context.addInitScript(redirectCatalogTransport);
  await Promise.all(context.pages().map(page => page.evaluate(redirectCatalogTransport)));
}

/** 고정 합성 데이터의 REST 쓰기는 준비 전용이며 측정 중 SDK/Functions 응답은 대체하지 않습니다. */
async function commitFixture(request: APIRequestContext, rows: Array<{ path: string; value: Record<string, unknown> }>): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += 400) {
    const response = await request.post(`http://127.0.0.1:8080/v1/${DATABASE}/documents:commit`, {
      headers: { authorization: 'Bearer owner' },
      data: { writes: rows.slice(offset, offset + 400).map(row => ({ update: {
        name: `${DATABASE}/documents/${row.path}`, fields: firestoreFields(row.value),
      } })) },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
}

export async function preparePerformanceFixture(page: Page, request: APIRequestContext): Promise<PerformanceFixture> {
  await resetTestAccount();
  const scope = await createHouseholdThroughUi(page, '성능 측정 가구', '성능 사용자');
  // 실제 Auth → 초대 → 가입 Command로 3명의 독립 Principal/Member를 준비합니다.
  for (const [email, memberName] of [['performance-partner@household.test', '성능 배우자'], ['performance-child@household.test', '성능 아이']]) {
    const account = await createEmulatorAccount(request, email);
    const invitation = await executeHouseholdCommand<{ invitationCode: string }>(request, {
      ...scope, command: 'access.create-invitation.v1', payload: {},
    });
    await executeHouseholdCommand(request, {
      idToken: account.idToken, command: 'access.join-household-as-self.v1',
      payload: { invitationCode: invitation.invitationCode, memberName },
    });
  }
  const categoryDocs = await readFirestoreCollection(request, 'categories');
  const keyFor = (label: string) => {
    const found = categoryDocs.find(doc => doc.fields?.label?.stringValue === label);
    expect(found, `기본 카테고리 ${label}`).toBeDefined();
    return found!.fields!.key.stringValue!;
  };
  const categories = { food: keyFor('식비'), other: keyFor('기타') };
  const targetDate = seoulDate(0, 15);
  const targetMerchant = '성능 원장 수정 대상';
  const targetAmount = 5000;
  const target = await executeHouseholdCommand<{ transactionId: string }>(request, {
    ...scope, command: 'ledger.record-manual-transaction.v1', payload: {
      transactionType: 'expense', merchant: targetMerchant, amountInWon: targetAmount,
      categoryId: categories.other, accountingDate: targetDate, memo: '초기 메모',
    },
  });
  const rows: Array<{ path: string; value: Record<string, unknown> }> = [];
  const monthTotals: number[] = [];
  for (let monthsAgo = 0; monthsAgo < FIXTURE_MONTHS; monthsAgo += 1) {
    let total = 0;
    for (let index = 0; index < EXPENSES_PER_MONTH; index += 1) {
      const amount = monthsAgo === 0 && index === 0 ? targetAmount : 1000 + index * 100 + monthsAgo * 10;
      total += amount;
      if (monthsAgo === 0 && index === 0) continue;
      // 28일까지 분산해 어느 실행 월에도 유효하며, 월별 크기와 합계는 매번 같습니다.
      const date = seoulDate(-monthsAgo, index % 28 + 1);
      const id = `performance-expense-${String(monthsAgo).padStart(2, '0')}-${String(index).padStart(2, '0')}`;
      rows.push({ path: `expenses/${id}`, value: {
        householdId: scope.householdId, merchant: `성능 원장 ${String(monthsAgo).padStart(2, '0')}-${String(index).padStart(2, '0')}`,
        amount, category: index % 2 ? categories.food : categories.other, date, time: '12:00',
        memo: `합성 거래 ${index}`, transactionType: 'expense', lifecycleState: 'active', aggregateVersion: 1,
        creatorMemberId: scope.memberId, cardType: 'manual', cardDisplay: '',
      } });
    }
    monthTotals.push(total);
  }
  rows.push({ path: `households/${scope.householdId}/homePreferences/home`, value: {
    left: 'MONTHLY_EXPENSE', right: 'LOCAL_CURRENCY_BALANCE', aggregateVersion: 1, selectedLocalCurrencyType: 'gyeonggi',
  } }, { path: `households/${scope.householdId}/localCurrencyBalances/gyeonggi`, value: {
    localCurrencyType: 'gyeonggi', balanceInWon: LOCAL_CURRENCY_BALANCE,
  } });

  // 자산·종목은 실제 Command로 생성해 부모 평가금액과 canonical/read model을 일치시킵니다.
  for (let index = 1; index <= 10; index += 1) {
    await executeHouseholdCommand(request, { ...scope, command: 'portfolio.create-asset.v1', payload: { asset: {
      name: `성능 예금 ${String(index).padStart(2, '0')}`, type: 'savings', owner: '공동', ownerRef: { kind: 'household' },
      currency: 'KRW', currentBalance: index * 100_000, isActive: true, order: index,
    } } });
  }
  const stock = await executeHouseholdCommand<{ assetId: string }>(request, { ...scope, command: 'portfolio.create-asset.v1', payload: { asset: {
    name: '성능 증권계좌', type: 'stock', owner: '공동', ownerRef: { kind: 'household' },
    currency: 'KRW', currentBalance: 0, isActive: true, order: 0,
  } } });
  for (let index = 1; index <= STOCK_COUNT; index += 1) {
    await executeHouseholdCommand(request, { ...scope, command: 'portfolio.add-position.v1', payload: {
      assetId: stock.assetId, positionKind: 'stock', expectedAssetVersion: index,
      // 실제 수동 보유 항목 경로로 공급자 네트워크/가격 변동을 측정에서 분리합니다.
      position: { assetId: stock.assetId, stockCode: '', stockName: `성능 보유항목 ${String(index).padStart(2, '0')}`,
        market: 'UNRESOLVED', holdingType: 'manual', quantity: 1, currentPrice: index * 10_000 },
    } });
  }
  await executeHouseholdCommand(request, { ...scope, command: 'portfolio.create-asset.v1', payload: { asset: {
    name: '성능 생활통장', type: 'savings', owner: '공동', ownerRef: { kind: 'household' },
    currency: 'KRW', currentBalance: 100_000, isActive: true, order: 11,
  } } });
  const assetTotal = 7_700_000;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const firstSnapshotDate = seoulDate(-(FIXTURE_MONTHS - 1), 1);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  let snapshotCount = 0;
  for (let at = Date.parse(`${firstSnapshotDate}T00:00:00Z`); at < todayMs; at += DAY) {
    const localDate = new Date(at).toISOString().slice(0, 10);
    const change = (todayMs - at) / DAY * DAILY_ASSET_CHANGE;
    rows.push({ path: `households/${scope.householdId}/assetSnapshots/${localDate}`, value: {
      schemaVersion: 1, householdId: scope.householdId, localDate, total: assetTotal - change, financial: assetTotal - change,
      byType: { savings: 5_600_000 - change, stock: 2_100_000 },
      byOwnerRefKey: { household: assetTotal - change }, ownerDisplayNames: { household: '공동' },
    } });
    snapshotCount += 1;
  }
  await commitFixture(request, rows);
  expect((await readFirestoreCollection(request, `households/${scope.householdId}/members`)).length).toBe(3);
  return { householdId: scope.householdId, targetId: target.transactionId, targetMerchant, targetDate, targetAmount,
    monthTotals, totalExpenseAmount: monthTotals.reduce((sum, amount) => sum + amount, 0), stockAssetId: stock.assetId,
    assetTotal, today, firstSnapshotDate, snapshotCount, categories };
}

/** 조회 성능 측정 종료 후 mutation 저장 결과만 확인합니다. 전체 원장을 읽지 않습니다. */
export async function readFixtureDocument(request: APIRequestContext, path: string): Promise<Record<string, unknown>> {
  const response = await request.get(`http://127.0.0.1:8080/v1/${DATABASE}/documents/${path}`, { headers: { authorization: 'Bearer owner' } });
  expect(response.ok(), await response.text()).toBe(true);
  const document = await response.json();
  return Object.fromEntries(Object.entries(document.fields ?? {}).map(([key, value]) => {
    const field = value as { stringValue?: string; integerValue?: string; booleanValue?: boolean };
    return [key, field.stringValue ?? (field.integerValue !== undefined ? Number(field.integerValue) : field.booleanValue)];
  }));
}

export function assetPeriodChange(fixture: PerformanceFixture, months: 3 | 6 | 12 | 'all'): string {
  const start = months === 'all' ? fixture.firstSnapshotDate : seoulDate(-(months - 1), 1);
  const days = (Date.parse(`${fixture.today}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY;
  const change = days * DAILY_ASSET_CHANGE;
  return `+${change.toLocaleString('ko-KR')}원 (+${(change / (fixture.assetTotal - change) * 100).toFixed(2)}%)`;
}
