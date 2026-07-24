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

  test('자산 페이지는 진입 즉시와 화면이 보이는 동안 30초마다 시세를 갱신한다', () => {
    const assetsPage = source('app/assets/page.tsx');
    const marketRefreshStart = assetsPage.indexOf(
      'const refreshMarketValues = (force = false) => {'
    );
    const marketRefreshEnd = assetsPage.indexOf(
      'useEffect(() => {',
      marketRefreshStart + 1
    );
    const marketRefreshEffect = assetsPage.slice(marketRefreshStart, marketRefreshEnd);
    const dailyRefreshStart = assetsPage.indexOf('const syncDailySummary = async () =>');
    const dailyRefreshEnd = assetsPage.indexOf(
      'const handleAssetClick',
      dailyRefreshStart
    );
    const dailyRefreshEffect = assetsPage.slice(dailyRefreshStart, dailyRefreshEnd);

    expect(assetsPage).toContain('const MARKET_REFRESH_INTERVAL_MS = 30_000;');
    expect(marketRefreshEffect).toContain('void refreshAllMarketValues()');
    expect(marketRefreshEffect).toContain('refreshMarketValues(true);');
    expect(marketRefreshEffect).toContain(
      'window.setInterval(\n      refreshMarketValues,\n      MARKET_REFRESH_INTERVAL_MS'
    );
    expect(marketRefreshEffect).toContain(
      "document.addEventListener('visibilitychange', handleVisibilityChange)"
    );
    expect(marketRefreshEffect).toContain(
      "document.visibilityState !== 'visible'"
    );
    expect(marketRefreshEffect).not.toContain('setTimeout');
    expect(marketRefreshEffect).not.toContain('requestIdleCallback');
    expect(dailyRefreshEffect).toContain('void syncDailySummary();');
    expect(dailyRefreshEffect).not.toContain('setTimeout');
    expect(dailyRefreshEffect).not.toContain('requestIdleCallback');
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
