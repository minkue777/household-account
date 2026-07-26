const RETIRED_HOME_READ_SNAPSHOT_PREFIXES = [
  'household-account.monthly-ledger.v1:',
  'household-account.categories.v1:',
  'household-account.local-currency-balance.v1:',
] as const;

/**
 * 서버 우선 첫 화면으로 전환하기 전에 저장했던 화면용 snapshot을 제거합니다.
 *
 * 로그인 연결을 복원하는 Membership 정보와 정적 자원 cache는 이 정리 대상이 아닙니다.
 */
export function clearRetiredHomeReadSnapshots(
  storage: Pick<Storage, 'key' | 'length' | 'removeItem'> = window.localStorage
): void {
  const keysToRemove: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (
      key
      && RETIRED_HOME_READ_SNAPSHOT_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => storage.removeItem(key));
}
