const mockRead = jest.fn();
const mockListen = jest.fn();
jest.mock('@/platform/read-model/firestoreReadModel', () => ({
  db: {}, doc: (...path: unknown[]) => path, collection: (...path: unknown[]) => path,
  query: (...parts: unknown[]) => parts, where: (...parts: unknown[]) => parts,
  onSnapshot: (...args: unknown[]) => mockListen(...args),
  onDocumentSnapshot: (...args: unknown[]) => mockListen(...args),
  timestampToDate: () => undefined,
}));
jest.mock('@/platform/read-model/firestoreServerReadModel', () => ({
  db: {}, doc: (...path: unknown[]) => path, collection: (...path: unknown[]) => path,
  query: (...parts: unknown[]) => parts, where: (...parts: unknown[]) => parts,
  getDocFromServer: (...args: unknown[]) => mockRead(...args),
  getDocsFromServer: (...args: unknown[]) => mockRead(...args),
}));
jest.mock('@/lib/utils/platform', () => ({ Platform: { isIOSPWA: jest.fn(() => true) } }));
jest.mock('@/platform/android-host/androidHostBridge', () => ({ isAndroidHostAvailable: jest.fn(() => false) }));

const identity = { sessionGeneration: 1, householdId: 'house-1', memberId: 'member-1', principalUid: 'user-1' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup() {
  const session = require('@/composition/clientSessionScope') as typeof import('@/composition/clientSessionScope');
  session.setClientSessionScope(identity);
  const diagnostics = require('@/platform/performance/clientStartupDiagnostics') as typeof import('@/platform/performance/clientStartupDiagnostics');
  diagnostics.startClientStartupDiagnostics();
  const source = require('@/platform/read-model/initialHomeRead') as typeof import('@/platform/read-model/initialHomeRead');
  return { session, diagnostics, ...source, scope: session.requireClientSessionScope() };
}
function rows(amount: number, version = 1, fromCache = false) {
  const document = { id: 'row-1', data: () => ({ householdId: identity.householdId, date: '2026-10-04',
    time: '09:00', amount, merchant: '상점', categoryId: 'etc', aggregateVersion: version, lifecycleState: 'active' }) };
  return { metadata: { fromCache }, docs: [document], docChanges: () => [{ type: 'modified', doc: document }] };
}

describe.each(['iPhone', 'Android'] as const)('[T-WEBVIEW-004][T-SYS-008][AND-012] %s 첫 홈 서버 조회 전환', runtime => {
  const expectedBudgetMs = runtime === 'Android' ? 2000 : 750;
  beforeEach(() => {
    jest.resetModules(); jest.useFakeTimers();
    mockRead.mockReset(); mockListen.mockReset().mockReturnValue(jest.fn());
    const platform = require('@/lib/utils/platform') as typeof import('@/lib/utils/platform');
    const bridge = require('@/platform/android-host/androidHostBridge') as typeof import('@/platform/android-host/androidHostBridge');
    jest.mocked(platform.Platform.isIOSPWA).mockReturnValue(runtime === 'iPhone');
    jest.mocked(bridge.isAndroidHostAvailable).mockReturnValue(runtime === 'Android');
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    const diagnostics = require('@/platform/performance/clientStartupDiagnostics') as typeof import('@/platform/performance/clientStartupDiagnostics');
    diagnostics.completeClientStartupDiagnostics();
    jest.useRealTimers();
  });

  it('일반 브라우저에서는 초기 Lite 조회 없이 기존 구독을 즉시 시작한다', () => {
    const value = setup();
    const platform = require('@/lib/utils/platform') as typeof import('@/lib/utils/platform');
    const bridge = require('@/platform/android-host/androidHostBridge') as typeof import('@/platform/android-host/androidHostBridge');
    jest.mocked(platform.Platform.isIOSPWA).mockReturnValue(false);
    jest.mocked(bridge.isAndroidHostAvailable).mockReturnValue(false);
    expect(value.diagnostics.isClientStartupInProgress()).toBe(true);
    const read = jest.fn(), listen = jest.fn(() => jest.fn());
    value.subscribeWithInitialHomeRead({ source: 'ledger', scope: value.scope, read, publish: jest.fn(), listen })();
    expect(read).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledTimes(1);
  });

  it('홈 이외 화면에서는 진단 중이어도 기존 구독을 즉시 시작한다', () => {
    const value = setup();
    window.history.replaceState(null, '', '/assets');
    const read = jest.fn(), listen = jest.fn(() => jest.fn());
    value.subscribeWithInitialHomeRead({ source: 'ledger', scope: value.scope, read, publish: jest.fn(), listen })();
    expect(read).not.toHaveBeenCalled(); expect(listen).toHaveBeenCalledTimes(1);
  });

  it('서버 응답을 표시한 뒤에만 구독을 시작하고 문서당 같은 원본을 재조회하지 않는다', async () => {
    const value = setup(), pending = deferred<number>(); const events: string[] = [];
    const read = jest.fn(() => pending.promise), stop = jest.fn();
    const options = { source: 'ledger' as const, scope: value.scope, read,
      publish: () => events.push('publish'), listen: () => { events.push('listen'); return stop; } };
    const cancel = value.subscribeWithInitialHomeRead(options);
    await flush(); expect(events).toEqual([]);
    pending.resolve(1); await flush(); expect(events).toEqual(['publish', 'listen']);
    cancel(); expect(stop).toHaveBeenCalledTimes(1);
    value.subscribeWithInitialHomeRead(options)();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('1230ms 정상 응답은 Android에서 표시하고 iPhone의 기존 750ms 복귀는 유지한다', async () => {
    const value = setup(), pending = deferred<number>(), events: string[] = [];
    const cancel = value.subscribeWithInitialHomeRead({ source: 'ledger', scope: value.scope,
      read: () => pending.promise, publish: () => events.push('publish'),
      listen: () => { events.push('listen'); return jest.fn(); } });
    await flush();
    jest.advanceTimersByTime(750);
    expect(events).toEqual(runtime === 'Android' ? [] : ['listen']);
    jest.advanceTimersByTime(480);
    pending.resolve(123); await flush();
    expect(events).toEqual(runtime === 'Android' ? ['publish', 'listen'] : ['listen']);
    const timings = value.diagnostics.completeClientStartupDiagnostics()?.timingsMs;
    if (runtime === 'Android') expect(timings).not.toHaveProperty('ledgerInitialReadFallback');
    else expect(timings).toHaveProperty('ledgerInitialReadFallback');
    cancel();
  });

  it('Android는 2000ms, iPhone은 750ms 경계에서 한 번 복귀하고 이후 성공 응답도 폐기한다', async () => {
    const value = setup(), pending = deferred<number>(), publish = jest.fn(), listen = jest.fn(() => jest.fn());
    const cancel = value.subscribeWithInitialHomeRead({ source: 'ledger', scope: value.scope,
      read: () => pending.promise, publish, listen });
    await flush();
    jest.advanceTimersByTime(expectedBudgetMs - 1);
    expect(listen).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(listen).toHaveBeenCalledTimes(1);
    pending.resolve(123); await flush(); jest.runOnlyPendingTimers();
    expect(publish).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledTimes(1);
    expect(value.diagnostics.completeClientStartupDiagnostics()?.timingsMs).toHaveProperty('ledgerInitialReadFallback');
    cancel();
  });

  it.each(['timeout', 'failure', 'decode'] as const)('%s이면 기존 구독으로 한 번 복귀하며 늦은 응답은 폐기한다', async kind => {
    const value = setup(), pending = deferred<number>(), publish = jest.fn(), listen = jest.fn(() => jest.fn());
    if (kind === 'decode') publish.mockImplementation(() => { throw new Error('invalid'); });
    const cancel = value.subscribeWithInitialHomeRead({ source: 'ledger', scope: value.scope,
      read: () => pending.promise, publish, listen });
    await flush();
    if (kind === 'timeout') jest.advanceTimersByTime(expectedBudgetMs);
    else if (kind === 'failure') pending.reject(new Error('unavailable'));
    else pending.resolve(1);
    await flush(); expect(listen).toHaveBeenCalledTimes(1);
    pending.resolve(2); await flush();
    expect(publish).toHaveBeenCalledTimes(kind === 'decode' ? 1 : 0);
    expect(value.diagnostics.completeClientStartupDiagnostics()?.timingsMs).toHaveProperty('ledgerInitialReadFallback');
    cancel();
  });

  it.each(['cancel', 'session'] as const)('%s 이후 결과와 timer는 표시·구독을 만들지 않는다', async kind => {
    const value = setup(), pending = deferred<number>(), publish = jest.fn(), listen = jest.fn(() => jest.fn());
    const cancel = value.subscribeWithInitialHomeRead({ source: 'ledger', scope: value.scope,
      read: () => pending.promise, publish, listen });
    await flush();
    if (kind === 'cancel') cancel(); else value.session.setClientSessionScope({ ...identity, sessionGeneration: 2 });
    pending.resolve(1); await flush(); jest.runOnlyPendingTimers();
    expect(publish).not.toHaveBeenCalled(); expect(listen).not.toHaveBeenCalled(); cancel();
  });

  it('시작 진단이 끝난 화면에서는 추가 조회 없이 바로 구독한다', () => {
    const value = setup(); value.diagnostics.completeClientStartupDiagnostics();
    const read = jest.fn(), listen = jest.fn(() => jest.fn());
    value.subscribeWithInitialHomeRead({ source: 'ledger', scope: value.scope, read, publish: jest.fn(), listen })();
    expect(read).not.toHaveBeenCalled(); expect(listen).toHaveBeenCalledTimes(1);
  });

  it('실제 원장 projection은 Lite 뒤 오래된 watch cache를 무시하고 수정·삭제·rollback을 유지한다', async () => {
    setup(); mockRead.mockResolvedValue(rows(100));
    const ledger = require('@/lib/expenseService') as typeof import('@/lib/expenseService');
    const { ledgerOptimisticProjection: projection } = require('@/features/ledger/application/ledgerOptimisticProjection') as typeof import('@/features/ledger/application/ledgerOptimisticProjection');
    const callback = jest.fn(); const stop = ledger.subscribeToMonthlyTransactions(2026, 10, callback);
    await flush(); expect(callback).toHaveBeenLastCalledWith([expect.objectContaining({ amount: 100 })]);
    const next = mockListen.mock.calls[0][2];
    const count = callback.mock.calls.length; next(rows(1, 0, true)); expect(callback).toHaveBeenCalledTimes(count);
    const update = projection.beginUpdate('row-1', { amount: 200 }, 'house-1');
    next(rows(100)); expect(callback).toHaveBeenLastCalledWith([expect.objectContaining({ amount: 200 })]);
    projection.rollback(update); expect(callback).toHaveBeenLastCalledWith([expect.objectContaining({ amount: 100 })]);
    next(rows(300, 2)); expect(callback).toHaveBeenLastCalledWith([expect.objectContaining({ amount: 300 })]);
    const deletion = projection.beginDelete('row-1', 'house-1');
    expect(callback).toHaveBeenLastCalledWith([]);
    projection.rollback(deletion); expect(callback).toHaveBeenLastCalledWith([expect.objectContaining({ amount: 300 })]);
    next({ metadata: { fromCache: false }, docs: [], docChanges: () => [{ type: 'removed', doc: rows(300).docs[0] }] });
    expect(callback).toHaveBeenLastCalledWith([]); stop();
  });

  it('홈 카드와 지역화폐 선택은 하나의 조회·구독을 공유하고 마지막 해제 때 종료한다', async () => {
    setup(); mockRead.mockResolvedValue({ data: () => ({ left: 'YEARLY_EXPENSE', selectedLocalCurrencyType: 'local' }) });
    const { subscribeToHomePreferencesDocument: subscribe } = require('@/platform/read-model/homePreferencesReadModel') as typeof import('@/platform/read-model/homePreferencesReadModel');
    const a = jest.fn(), b = jest.fn(); const stopA = subscribe('house-1', a), stopB = subscribe('house-1', b);
    await flush(); expect(mockRead).toHaveBeenCalledTimes(1); expect(mockListen).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenLastCalledWith({ left: 'YEARLY_EXPENSE', selectedLocalCurrencyType: 'local' });
    expect(b).toHaveBeenLastCalledWith(a.mock.calls.at(-1)![0]);
    const next = mockListen.mock.calls[0][2], unsubscribe = mockListen.mock.results[0].value;
    next({ metadata: { fromCache: true }, data: () => ({ left: 'MONTHLY_EXPENSE' }) });
    expect(a).toHaveBeenCalledTimes(1);
    stopA(); expect(unsubscribe).not.toHaveBeenCalled();
    next({ metadata: { fromCache: false }, data: () => undefined });
    expect(b).toHaveBeenLastCalledWith(undefined); expect(a).toHaveBeenCalledTimes(1);
    stopB(); expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('공유 구독 실패 뒤 같은 scope의 재연결은 남은 observer도 복구하고 종료된 구독의 늦은 응답을 무시한다', async () => {
    setup(); mockRead.mockResolvedValue({ data: () => ({ aggregateVersion: 1 }) });
    const { subscribeToHomePreferencesDocument: subscribe } = require('@/platform/read-model/homePreferencesReadModel') as typeof import('@/platform/read-model/homePreferencesReadModel');
    const a = jest.fn(), b = jest.fn(), failure = jest.fn();
    const stopA = subscribe('house-1', a, failure), stopB = subscribe('house-1', b);
    await flush();
    const old = mockListen.mock.calls[0], oldStop = mockListen.mock.results[0].value;
    old[3](new Error('permission-denied')); expect(failure).toHaveBeenCalledTimes(1);
    stopB();
    const stopNewB = subscribe('house-1', b);
    expect(oldStop).toHaveBeenCalledTimes(1);
    expect(mockListen).toHaveBeenCalledTimes(2); expect(mockRead).toHaveBeenCalledTimes(1);
    mockListen.mock.calls[1][2]({ metadata: { fromCache: false }, data: () => ({ aggregateVersion: 2 }) });
    expect(a).toHaveBeenLastCalledWith({ aggregateVersion: 2 });
    expect(b).toHaveBeenLastCalledWith({ aggregateVersion: 2 });
    const count = a.mock.calls.length;
    old[2]({ metadata: { fromCache: false }, data: () => ({ aggregateVersion: 1 }) });
    old[3](new Error('late'));
    expect(a).toHaveBeenCalledTimes(count); expect(failure).toHaveBeenCalledTimes(1);
    stopA(); stopNewB();
  });
});
