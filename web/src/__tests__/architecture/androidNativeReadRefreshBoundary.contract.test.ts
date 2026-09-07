import fs from 'node:fs';
import path from 'node:path';

const sourceRoot = path.resolve(process.cwd(), 'src');

function source(relativePath: string): string {
  return fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8');
}

describe('Android native 복귀 읽기 경계', () => {
  it('복귀 catch-up은 Ledger 월·연 원장과 지역화폐에만 전파한다', () => {
    const appProviders = source('components/AppProviders.tsx');
    const ledgerReadModel = source('contexts/LedgerReadModelContext.tsx');
    const ledgerPage = source('components/home/LedgerPage.tsx');

    expect(appProviders).not.toContain('refreshRemoteReads');
    expect(ledgerReadModel).toContain('ANDROID_NATIVE_RESUME_EVENT');
    expect(ledgerReadModel).toContain('readRefreshKey');
    // Context 수신, 연간 조회 갱신, 이전 세대 인접 월 prefetch 취소에만 사용합니다.
    expect(ledgerPage.match(/\breadRefreshKey\b/g)).toHaveLength(3);

    for (const unrelatedReadModel of [
      'contexts/CategoryContext.tsx',
      'app/assets/page.tsx',
      'app/assets/stats/page.tsx',
      'components/settings/CardSettings.tsx',
      'components/settings/RecurringExpenseSettings.tsx',
    ]) {
      const unrelatedSource = source(unrelatedReadModel);
      expect(unrelatedSource).not.toContain('ANDROID_NATIVE_RESUME_EVENT');
      expect(unrelatedSource).not.toContain('readRefreshKey');
    }
  });
});
