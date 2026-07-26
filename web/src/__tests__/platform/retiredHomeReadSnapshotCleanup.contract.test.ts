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

  it('마이그레이션을 한 번 완료한 뒤에는 localStorage 전체를 다시 순회하지 않는다', () => {
    const firstRetiredKey =
      'household-account.monthly-ledger.v1:household-1:2026-07:expense';
    const laterRetiredKey =
      'household-account.categories.v1:household-1';
    window.localStorage.setItem(firstRetiredKey, 'ledger');

    clearRetiredHomeReadSnapshots();
    window.localStorage.setItem(laterRetiredKey, 'categories');
    clearRetiredHomeReadSnapshots();

    expect(window.localStorage.getItem(firstRetiredKey)).toBeNull();
    expect(window.localStorage.getItem(laterRetiredKey)).toBe('categories');
  });

  it('브라우저가 저장소 접근을 거부해도 첫 화면 초기화를 중단하지 않는다', () => {
    const deniedStorage = {
      get length() {
        throw new Error('storage denied');
      },
      getItem: () => {
        throw new Error('storage denied');
      },
      key: () => null,
      removeItem: () => undefined,
      setItem: () => undefined,
    };

    expect(() => clearRetiredHomeReadSnapshots(deniedStorage)).not.toThrow();
  });
});
