const mockOnSnapshot = jest.fn();
const mockGetDocFromServer = jest.fn();
jest.mock('@/platform/read-model/firestoreReadModel', () => ({
  db: {},
  collection: (...segments: unknown[]) => ({ segments }),
  doc: (...segments: unknown[]) => ({ segments }),
  query: (...constraints: unknown[]) => ({ constraints }),
  where: (...constraint: unknown[]) => ({ constraint }),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  onDocumentSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  getDocFromServer: (...args: unknown[]) => mockGetDocFromServer(...args),
  timestampToDate: (value: unknown) => value instanceof Date ? value : undefined,
}));
jest.mock('@/features/ledger/application/ledgerOptimisticProjection', () => ({
  ledgerOptimisticProjection: {
    subscribe: (callback: (items: unknown[]) => void, accept: (item: unknown) => boolean) => ({
      publish: (items: unknown[]) => callback(items.filter(accept)),
      dispose: jest.fn(),
    }),
  },
}));
jest.mock('@/lib/utils/platform', () => ({ Platform: { isIOSPWA: () => true } }));
jest.mock('@/platform/performance/clientStartupDiagnostics', () => {
  const actual = jest.requireActual('@/platform/performance/clientStartupDiagnostics') as typeof import('@/platform/performance/clientStartupDiagnostics');
  return { ...actual, isClientStartupInProgress: () => false, recordClientStartupTiming: (...args: Parameters<typeof actual.recordClientStartupTiming>) => actual.recordClientStartupTiming(...args) };
});

const initialScope = {
  householdId: 'household-1', principalUid: 'principal-1', memberId: 'member-1', sessionGeneration: 1,
};
type Snapshot = {
  id: string;
  metadata: { fromCache: boolean };
  exists: () => boolean;
  data: () => Record<string, unknown>;
  docs: { id: string; data: () => Record<string, unknown> }[];
  docChanges: () => [];
};
type Subject = ReturnType<typeof subject>;

function subject() {
  const diagnostics = require('@/platform/performance/clientStartupDiagnostics') as typeof import('@/platform/performance/clientStartupDiagnostics');
  const scope = require('@/composition/clientSessionScope') as typeof import('@/composition/clientSessionScope');
  scope.setClientSessionScope(initialScope);
  diagnostics.startClientStartupDiagnostics();
  return {
    diagnostics, scope,
    household: require('@/lib/householdService') as typeof import('@/lib/householdService'),
    ledger: require('@/lib/expenseService') as typeof import('@/lib/expenseService'),
    categories: require('@/lib/categoryService') as typeof import('@/lib/categoryService'),
    currency: require('@/lib/balanceService') as typeof import('@/lib/balanceService'),
  };
}

function next(index = 0): (snapshot: Snapshot) => void {
  const args = mockOnSnapshot.mock.calls[index];
  return args[typeof args[1] === 'function' ? 1 : 2];
}

describe('[T-ADM-005][ADM-006] 홈 read 서비스의 시작 단계 관측 계약', () => {
  let clock: number;
  let events: string[];

  function snapshot(fromCache = false, fields: Record<string, unknown> = {}): Snapshot {
    const data = () => { events.push('map'); return fields; };
    return { id: 'row-1', metadata: { fromCache }, exists: () => true, data,
      docs: [{ id: 'row-1', data }], docChanges: () => [] };
  }
  function ledgerSnapshot(fromCache = false) {
    return snapshot(fromCache, {
      householdId: initialScope.householdId, date: '2026-09-30', time: '09:00',
      amount: 100, merchant: '거래', categoryId: 'etc', aggregateVersion: 1, lifecycleState: 'active',
    });
  }
  function observe(value: Subject) {
    const original = value.diagnostics.recordClientStartupTiming;
    jest.spyOn(value.diagnostics, 'recordClientStartupTiming').mockImplementation((key, at) => {
      events.push(key);
      original(key, at);
    });
  }
  function finish(value: Subject) {
    clock = 1_000;
    return value.diagnostics.completeClientStartupDiagnostics()!.timingsMs;
  }

  beforeEach(() => {
    jest.resetModules();
    clock = 10;
    events = [];
    jest.spyOn(window.performance, 'now').mockImplementation(() => clock);
    mockOnSnapshot.mockReset().mockImplementation(() => { events.push('listen'); return jest.fn(); });
    mockGetDocFromServer.mockReset();
  });
  afterEach(() => {
    const diagnostics = require('@/platform/performance/clientStartupDiagnostics') as typeof import('@/platform/performance/clientStartupDiagnostics');
    diagnostics.completeClientStartupDiagnostics(1_000);
    jest.restoreAllMocks();
  });

  it('가구 요청 직전과 mapper 전 응답을 기록하고 반환값을 유지한다', async () => {
    const value = subject();
    observe(value);
    let resolve!: (result: Snapshot) => void;
    mockGetDocFromServer.mockImplementation(() => {
      events.push('request');
      return new Promise<Snapshot>(complete => { resolve = complete; });
    });
    clock = 100;
    const loading = value.household.getHousehold(initialScope.householdId);
    expect(events).toEqual(['householdReadStarted', 'request']);
    clock = 200;
    resolve(snapshot(false, { name: '가구', members: [] }));
    await expect(loading).resolves.toMatchObject({ id: 'row-1', name: '가구' });
    expect(events).toEqual(['householdReadStarted', 'request', 'householdSnapshotReceived', 'map']);
    expect(finish(value)).toMatchObject({ householdReadStarted: 100, householdSnapshotReceived: 200 });
  });

  it('가구 요청 중 세션이 교체되면 늦은 응답은 진단에서만 제외한다', async () => {
    const value = subject();
    let resolve!: (result: Snapshot) => void;
    mockGetDocFromServer.mockImplementation(() => new Promise<Snapshot>(complete => { resolve = complete; }));
    const loading = value.household.getHousehold(initialScope.householdId);
    value.scope.setClientSessionScope({ ...initialScope, sessionGeneration: 2 });
    resolve(snapshot(false, { name: '가구', members: [] }));
    await expect(loading).resolves.toMatchObject({ name: '가구' });
    expect(finish(value)).toHaveProperty('householdReadStarted');
    expect(finish(value)).not.toHaveProperty('householdSnapshotReceived');
  });

  it('월 원장은 cache를 건너뛰고 mapper·사용자 callback 앞에 서버 관측을 기록하며 최초 시각을 동결한다', () => {
    const value = subject();
    observe(value);
    const callback = jest.fn(() => { events.push('callback'); });
    clock = 100;
    value.ledger.subscribeToMonthlyTransactions(2026, 9, callback);
    expect(mockOnSnapshot.mock.calls[0][1]).toEqual({ includeMetadataChanges: true });
    expect(events).toEqual(['ledgerListenStarted', 'listen']);
    clock = 150; next()(ledgerSnapshot(true));
    expect(events).toEqual(['ledgerListenStarted', 'listen']);
    clock = 200; next()(ledgerSnapshot());
    expect(events).toEqual(['ledgerListenStarted', 'listen', 'ledgerServerSnapshotReceived', 'map', 'callback']);
    expect(callback).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'row-1', amount: 100 })]);
    clock = 300; next()(ledgerSnapshot());
    const timings = finish(value);
    expect(timings).toMatchObject({ ledgerListenStarted: 100, ledgerServerSnapshotReceived: 200 });
    value.ledger.subscribeToDateRangeExpenses('2026-01-01', '2026-12-31', jest.fn());
    next(1)(ledgerSnapshot());
    expect(finish(value)).toEqual(timings);
  });

  it('카테고리는 최초 서버 callback을 검증 mapper보다 먼저 기록한다', () => {
    const value = subject();
    observe(value);
    const callback = jest.fn(() => { events.push('callback'); });
    clock = 100;
    value.categories.subscribeToCategoryCatalog(initialScope.householdId, callback);
    clock = 150; next()(snapshot(true));
    expect(events).toEqual(['categoriesListenStarted', 'listen']);
    clock = 200;
    next()(snapshot(false, { schemaVersion: 1, householdId: initialScope.householdId,
      categories: [], catalogVersion: 1, defaultCategoryId: null }));
    expect(events).toEqual(['categoriesListenStarted', 'listen', 'categoriesServerSnapshotReceived', 'map', 'callback']);
    expect(callback).toHaveBeenLastCalledWith({ categories: [], catalogVersion: 1, defaultCategoryId: undefined });
    expect(finish(value)).toMatchObject({ categoriesListenStarted: 100, categoriesServerSnapshotReceived: 200 });
  });

  it('지역화폐 설정과 잔액을 독립 기록하고 두 서버 snapshot 뒤의 기존 표시 조건을 유지한다', () => {
    const value = subject();
    observe(value);
    const callback = jest.fn(() => { events.push('callback'); });
    clock = 100;
    value.currency.subscribeToLocalCurrencyBalance(callback);
    expect(mockOnSnapshot.mock.calls.map(call => call[1])).toEqual([
      { includeMetadataChanges: true }, { includeMetadataChanges: true },
    ]);
    const preference = snapshot(false, { selectedLocalCurrencyType: 'currency-1' });
    const balance = snapshot(false, { localCurrencyType: 'currency-1', balanceInWon: 123 });
    clock = 150; next()(snapshot(true)); next(1)(snapshot(true));
    expect(events).toEqual(['currencyPreferencesListenStarted', 'listen', 'currencyBalancesListenStarted', 'listen']);
    clock = 200; next()(preference);
    expect(callback).not.toHaveBeenCalled();
    clock = 300; next(1)(balance);
    expect(events.slice(4)).toEqual(['currencyPreferencesServerSnapshotReceived', 'map',
      'currencyBalancesServerSnapshotReceived', 'map', 'callback']);
    expect(callback).toHaveBeenLastCalledWith({ balance: 123, currencyType: 'currency-1', updatedAt: null });
    expect(finish(value)).toMatchObject({ currencyPreferencesListenStarted: 100, currencyBalancesListenStarted: 100,
      currencyPreferencesServerSnapshotReceived: 200, currencyBalancesServerSnapshotReceived: 300 });
  });

  it('연간 합계는 metadata 변경을 수신하고 cache 첫 표시와 서버 도착을 분리한다', () => {
    const value = subject();
    observe(value);
    const callback = jest.fn(() => { events.push('callback'); });
    clock = 100;
    value.ledger.subscribeToDateRangeExpenses('2026-01-01', '2026-12-31', callback);
    expect(mockOnSnapshot.mock.calls[0][1]).toEqual({ includeMetadataChanges: true });
    clock = 150; next()(ledgerSnapshot(true));
    expect(events).toEqual(['yearSummaryListenStarted', 'listen', 'yearSummaryFirstSnapshotReceived', 'map', 'callback']);
    clock = 200; next()(ledgerSnapshot());
    expect(events.slice(-3)).toEqual(['yearSummaryFirstSnapshotReceived', 'yearSummaryServerSnapshotReceived', 'callback']);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(finish(value)).toMatchObject({ yearSummaryListenStarted: 100,
      yearSummaryFirstSnapshotReceived: 150, yearSummaryServerSnapshotReceived: 200 });
  });

  it.each(['월', '연간', '카테고리', '지역화폐'] as const)('%s 구독의 취소·세션 교체 뒤 callback은 진단에 추가하지 않는다', kind => {
    const value = subject();
    const subscribe = () => kind === '월' ? value.ledger.subscribeToMonthlyTransactions(2026, 9, jest.fn())
      : kind === '연간' ? value.ledger.subscribeToDateRangeExpenses('2026-01-01', '2026-12-31', jest.fn())
        : kind === '카테고리' ? value.categories.subscribeToCategoryCatalog(initialScope.householdId, jest.fn())
          : value.currency.subscribeToLocalCurrencyBalance(jest.fn());
    const emit = (offset: number) => {
      const result = kind === '카테고리'
        ? snapshot(false, { schemaVersion: 1, householdId: initialScope.householdId,
          categories: [], catalogVersion: 1, defaultCategoryId: null }) : ledgerSnapshot();
      next(offset)(result);
      if (kind === '지역화폐') next(offset + 1)(snapshot());
    };
    const cancel = subscribe();
    cancel();
    emit(0);
    const offset = mockOnSnapshot.mock.calls.length;
    subscribe();
    value.scope.setClientSessionScope({ ...initialScope, sessionGeneration: 2 });
    emit(offset);
    expect(Object.keys(finish(value)).filter(key => key.endsWith('Received'))).toEqual([]);
    expect(mockOnSnapshot.mock.results[0].value).toHaveBeenCalledTimes(1);
  });

  it('진단 시계 API 실패는 서버 snapshot의 mapping과 사용자 callback을 막지 않는다', () => {
    const value = subject();
    jest.mocked(window.performance.now).mockImplementation(() => { throw new Error('clock unavailable'); });
    const callback = jest.fn();
    expect(() => value.ledger.subscribeToMonthlyTransactions(2026, 9, callback)).not.toThrow();
    expect(() => next()(ledgerSnapshot())).not.toThrow();
    expect(callback).toHaveBeenLastCalledWith([expect.objectContaining({ amount: 100 })]);
  });
});
