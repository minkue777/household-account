const collectionMock = jest.fn((...segments: unknown[]) => ({
  kind: 'balances',
  segments,
}));
const docMock = jest.fn((...segments: unknown[]) => ({
  kind: 'preference',
  segments,
}));
const unsubscribeBalances = jest.fn();
const unsubscribePreference = jest.fn();
const listeners = new Map<
  string,
  {
    next: (snapshot: any) => void;
    error: (error: unknown) => void;
  }
>();

jest.mock('@/platform/read-model/firestoreReadModel', () => ({
  db: { kind: 'db' },
  collection: (...segments: unknown[]) => collectionMock(...segments),
  doc: (...segments: unknown[]) => docMock(...segments),
  onSnapshot: (
    reference: { kind: string },
    next: (snapshot: any) => void,
    error: (error: unknown) => void
  ) => {
    listeners.set(reference.kind, { next, error });
    return reference.kind === 'balances' ? unsubscribeBalances : unsubscribePreference;
  },
  timestampToDate: (value: unknown) => value instanceof Date ? value : undefined,
}));

jest.mock('@/composition/clientSessionScope', () => ({
  getClientSessionScope: () => ({
    sessionGeneration: 1,
    principalUid: 'principal-1',
    householdId: 'household-1',
    memberId: 'member-1',
    accessMode: 'member',
  }),
  requireClientSessionScope: () => ({
    sessionGeneration: 1,
    principalUid: 'principal-1',
    householdId: 'household-1',
    memberId: 'member-1',
    accessMode: 'member',
  }),
}));

import { subscribeToLocalCurrencyBalance } from '@/lib/balanceService';

function balanceDocument(
  id: string,
  balanceInWon: number,
  updatedAt = new Date('2026-07-23T08:02:15.234Z')
) {
  return {
    id,
    data: () => ({
      localCurrencyType: id,
      balanceInWon,
      updatedAt,
    }),
  };
}

describe('지역화폐 잔액 읽기 계약', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    localStorage.clear();
    listeners.clear();
    collectionMock.mockClear();
    docMock.mockClear();
    unsubscribeBalances.mockClear();
    unsubscribePreference.mockClear();
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('[T-BAL-004][BAL-004] 권한이 없는 레거시 root가 아니라 가구 하위 canonical balance를 구독한다', () => {
    const callback = jest.fn();
    const unsubscribe = subscribeToLocalCurrencyBalance(callback);

    expect(collectionMock).toHaveBeenCalledWith(
      { kind: 'db' },
      'households',
      'household-1',
      'localCurrencyBalances'
    );
    expect(collectionMock).not.toHaveBeenCalledWith(
      { kind: 'db' },
      'balances'
    );

    listeners.get('balances')?.next({
      docs: [balanceDocument('gyeonggi', 1_153_429)],
    });

    expect(callback).toHaveBeenLastCalledWith({
      balance: 1_153_429,
      currencyType: 'gyeonggi',
      updatedAt: new Date('2026-07-23T08:02:15.234Z'),
    });

    unsubscribe();
    expect(unsubscribeBalances).toHaveBeenCalledTimes(1);
    expect(unsubscribePreference).toHaveBeenCalledTimes(1);
  });

  it('[T-BAL-006][BAL-004] 일시적인 구독 오류가 이미 표시한 DB 값을 지우지 않는다', () => {
    const callback = jest.fn();
    subscribeToLocalCurrencyBalance(callback);
    listeners.get('balances')?.next({
      docs: [balanceDocument('gyeonggi', 1_153_429)],
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({
      balance: 1_153_429,
      currencyType: 'gyeonggi',
    }));

    listeners.get('balances')?.error(new Error('temporarily unavailable'));
    listeners.get('preference')?.error(new Error('temporarily unavailable'));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('[T-BAL-004][BAL-004] 여러 지역화폐가 있으면 Home Preferences가 선택한 유형만 표시한다', () => {
    const callback = jest.fn();
    subscribeToLocalCurrencyBalance(callback);

    listeners.get('balances')?.next({
      docs: [
        balanceDocument('gyeonggi', 20_000),
        balanceDocument('daejeon', 3_289),
      ],
    });
    expect(callback).not.toHaveBeenCalled();

    listeners.get('preference')?.next({
      exists: () => true,
      data: () => ({ selectedLocalCurrencyType: 'daejeon' }),
    });
    expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({
      balance: 3_289,
      currencyType: 'daejeon',
    }));
  });
});
