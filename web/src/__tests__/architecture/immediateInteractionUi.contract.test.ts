import fs from 'node:fs';
import path from 'node:path';

const srcRoot = path.join(process.cwd(), 'src');

function source(relativePath: string): string {
  return fs.readFileSync(path.join(srcRoot, relativePath), 'utf8');
}

describe('즉시 상호작용 UI 계약', () => {
  test('원장의 클릭 UI는 동적 청크나 준비 화면 없이 페이지 번들에 포함한다', () => {
    const ledgerPage = source('components/home/LedgerPage.tsx');

    expect(ledgerPage).not.toContain("from 'next/dynamic'");
    expect(ledgerPage).not.toContain('InteractionLoadingFallback');
    expect(ledgerPage).toContain(
      "import CategoryDetailModal from '@/components/CategoryDetailModal'"
    );
    expect(ledgerPage).toContain(
      "import ExpenseDetail from '@/components/expense/ExpenseDetail'"
    );
    expect(ledgerPage).toContain(
      "import SearchModal from '@/components/search/SearchModal'"
    );
  });

  test('자산의 추가·수정·내역 모달은 클릭 전에 페이지 번들에 포함한다', () => {
    const assetsPage = source('app/assets/page.tsx');

    expect(assetsPage).not.toContain("from 'next/dynamic'");
    expect(assetsPage).not.toContain('InteractionLoadingFallback');
    expect(assetsPage).toContain(
      "import AssetEditModal from '@/components/assets/AssetEditModal'"
    );
    expect(assetsPage).toContain(
      "import AssetHistoryModal from '@/components/assets/AssetHistoryModal'"
    );
  });

  test('자산 페이지는 진입할 때만 시세를 한 번 갱신하고 직전 일간 변동을 먼저 표시한다', () => {
    const assetsPage = source('app/assets/page.tsx');
    const marketRefreshStart = assetsPage.indexOf('void refreshAllMarketValues()');
    const marketRefreshEffectStart = assetsPage.lastIndexOf(
      'useEffect(() => {',
      marketRefreshStart
    );
    const marketRefreshEnd = assetsPage.indexOf(
      'useEffect(() => {',
      marketRefreshStart + 1
    );
    const marketRefreshEffect = assetsPage.slice(
      marketRefreshEffectStart,
      marketRefreshEnd
    );
    const dailyRefreshStart = assetsPage.indexOf(
      'const activeAssets = sourceAssets.filter'
    );
    const dailyRefreshEnd = assetsPage.indexOf(
      'const handleAssetClick',
      dailyRefreshStart
    );
    const dailyRefreshEffect = assetsPage.slice(dailyRefreshStart, dailyRefreshEnd);

    expect(marketRefreshEffect).toContain('void refreshAllMarketValues()');
    expect(marketRefreshEffect).toContain('!serverAssetsReady');
    expect(marketRefreshEffect).not.toContain('window.setInterval');
    expect(marketRefreshEffect).not.toContain(
      "document.addEventListener('visibilitychange'"
    );
    expect(marketRefreshEffect).not.toContain('setTimeout');
    expect(marketRefreshEffect).not.toContain('requestIdleCallback');
    expect(assetsPage).toContain('readDailyAssetChangeSnapshot(householdId)');
    expect(dailyRefreshEffect).toContain(
      'writeDailyAssetChangeSnapshot(householdId, amounts)'
    );
    expect(assetsPage).toContain('readPreviousAssetDailySummary(');
    expect(dailyRefreshEffect).toContain('calculateRealtimeDailyAssetChanges({');
    expect(dailyRefreshEffect).not.toContain('Promise.all(');
    expect(dailyRefreshEffect).not.toContain('memberOptions.map(async');
    expect(assetsPage).not.toContain('getRealtimeDailyAssetChangeByOwner');
    expect(dailyRefreshEffect).not.toContain('setTimeout');
    expect(dailyRefreshEffect).not.toContain('requestIdleCallback');
  });

  test('종목 카탈로그는 앱 시작이 아니라 자산 페이지 첫 표시 뒤 백그라운드에서 준비한다', () => {
    const appProviders = source('components/AppProviders.tsx');
    const assetsPage = source('app/assets/page.tsx');
    const catalogWarm = assetsPage.indexOf('warmStockInstrumentCatalog');

    expect(appProviders).not.toContain('stockInstrumentCatalogRuntime');
    expect(catalogWarm).toBeGreaterThanOrEqual(0);
    expect(assetsPage).toContain('frameId = window.requestAnimationFrame(() =>');
    expect(assetsPage).toContain('delayId = window.setTimeout(warm, 0)');
  });

  test('자산 재진입 snapshot에는 optimistic 화면값이 아니라 source snapshot만 저장한다', () => {
    const assetsPage = source('app/assets/page.tsx');
    const subscriptionStart = assetsPage.indexOf('const unsubscribe = subscribeToAssets(');
    const subscriptionEnd = assetsPage.indexOf(
      'return () => unsubscribe();',
      subscriptionStart
    );
    const subscription = assetsPage.slice(subscriptionStart, subscriptionEnd);
    const optimisticCallbackEnd = subscription.indexOf('cachedAssetsRef.current');

    expect(subscriptionStart).toBeGreaterThanOrEqual(0);
    expect(subscription.slice(0, optimisticCallbackEnd)).not.toContain(
      'writeAssetSnapshot'
    );
    expect(subscription.slice(optimisticCallbackEnd)).toContain(
      'writeAssetSnapshot(household.id, nextSourceAssets)'
    );
  });

  test('일일 자산 합계도 실패할 수 있는 optimistic 값 대신 source snapshot으로 계산한다', () => {
    const assetsPage = source('app/assets/page.tsx');
    const dailyRefreshStart = assetsPage.indexOf(
      'const activeAssets = sourceAssets.filter'
    );
    const dailyRefreshEnd = assetsPage.indexOf(
      'const handleAssetClick',
      dailyRefreshStart
    );
    const dailyRefresh = assetsPage.slice(dailyRefreshStart, dailyRefreshEnd);

    expect(dailyRefreshStart).toBeGreaterThanOrEqual(0);
    expect(dailyRefresh).toContain('sourceAssets');
    expect(dailyRefresh).not.toContain('assets.filter');
  });

  test('자산 생성 뒤 일부 보유 항목만 실패하면 전체 생성 실패로 오인시키지 않는다', () => {
    const addModal = source('components/assets/AssetAddModal.tsx');
    const submitStart = addModal.indexOf('const pendingAsset = addAsset(input)');
    const submitEnd = addModal.indexOf(
      '} catch (error) {',
      submitStart
    );
    const submit = addModal.slice(submitStart, submitEnd);

    expect(submitStart).toBeGreaterThanOrEqual(0);
    expect(submit).toContain('Promise.allSettled(');
    expect(submit).toContain("result.status === 'rejected'");
    expect(submit).toContain('자산은 추가됐지만 보유 항목');
    expect(submit).not.toContain('await Promise.all(');
  });

  test('사용자 클릭 뒤 표시되는 화면 준비 문구를 제품 코드에 두지 않는다', () => {
    const productFiles = [
      'components/home/LedgerPage.tsx',
      'app/assets/page.tsx',
      'components/common',
    ];
    const commonFiles = fs
      .readdirSync(path.join(srcRoot, productFiles[2]))
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => source(path.join(productFiles[2], name)));

    expect([
      source(productFiles[0]),
      source(productFiles[1]),
      ...commonFiles,
    ].join('\n')).not.toContain('화면 준비 중');
  });

  test('모바일의 일반 클릭 대상은 double-tap 판정으로 지연되지 않는다', () => {
    const globalStyles = source('app/globals.css');

    expect(globalStyles).toMatch(
      /button,\s*a,\s*\[role='button'\]\s*\{\s*touch-action:\s*manipulation;/
    );
  });
});
