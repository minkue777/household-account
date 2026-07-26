import { clearRetiredHomeReadSnapshots } from '@/platform/read-model/retiredHomeReadSnapshotCleanup';

describe('폐기된 가계부 첫 화면 캐시 정리 계약', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('화면 데이터 snapshot만 제거하고 로그인 연결과 정적 설정은 보존한다', () => {
    window.localStorage.setItem(
      'household-account.monthly-ledger.v1:household-1:2026-07:expense',
      'ledger'
    );
    window.localStorage.setItem(
      'household-account.categories.v1:household-1',
      'categories'
    );
    window.localStorage.setItem(
      'household-account.local-currency-balance.v1:household-1',
      'balance'
    );
    window.localStorage.setItem(
      'household-account.signed-in-membership.v1',
      'membership'
    );
    window.localStorage.setItem('theme', 'dark');

    clearRetiredHomeReadSnapshots();

    expect(window.localStorage.getItem(
      'household-account.monthly-ledger.v1:household-1:2026-07:expense'
    )).toBeNull();
    expect(window.localStorage.getItem(
      'household-account.categories.v1:household-1'
    )).toBeNull();
    expect(window.localStorage.getItem(
      'household-account.local-currency-balance.v1:household-1'
    )).toBeNull();
    expect(window.localStorage.getItem(
      'household-account.signed-in-membership.v1'
    )).toBe('membership');
    expect(window.localStorage.getItem('theme')).toBe('dark');
  });
});
