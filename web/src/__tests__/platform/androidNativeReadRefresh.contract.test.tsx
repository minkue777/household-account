import { act, render } from '@testing-library/react';

const recoverRemoteSession = jest.fn().mockResolvedValue(undefined);
const mockRoutePrefetch = jest.fn();
const mockScheduleAfterWebFirstLedgerPaint = jest.fn((
  _task: () => void,
  _options?: { delayAfterPaintMs?: number; idleTimeoutMs?: number }
) => jest.fn());

jest.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch: mockRoutePrefetch }),
}));

jest.mock('@/contexts/HouseholdContext', () => ({
  HouseholdProvider: ({ children }: { children: React.ReactNode }) => children,
  useHousehold: () => ({
    sessionState: 'ready',
    isSessionVerified: true,
    adminHouseholdView: null,
    householdKey: 'household-1',
    currentMember: { id: 'member-1', name: '멤버', aggregateVersion: 1 },
    recoverRemoteSession,
  }),
}));

jest.mock('@/platform/android-host/androidHostBridge', () => ({
  isAndroidHostAvailable: () => true,
  refreshAndroidHostSession: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/composition/clientSessionScope', () => ({
  getClientSessionScope: () => ({
    principalUid: 'uid-1',
    householdId: 'household-1',
    memberId: 'member-1',
  }),
}));

jest.mock('@/platform/performance/webStartupPerformance', () => ({
  scheduleAfterWebFirstLedgerPaint: (
    task: () => void,
    options?: { delayAfterPaintMs?: number; idleTimeoutMs?: number }
  ) => mockScheduleAfterWebFirstLedgerPaint(task, options),
  scheduleAfterWebFirstHomeCompletePaint: (
    task: () => void,
    options?: { delayAfterPaintMs?: number; idleTimeoutMs?: number }
  ) => mockScheduleAfterWebFirstLedgerPaint(task, options),
}));

jest.mock('@/composition/ledgerMutationRuntimePreload', () => ({
  preloadLedgerMutationRuntime: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/platform/functions-api/firebaseCallableRecovery', () => ({
  REMOTE_SESSION_RECOVERY_REQUESTED_EVENT: 'household-account:remote-session-recovery-requested',
}));

jest.mock('@/platform/read-model/retiredHomeReadSnapshotCleanup', () => ({
  clearRetiredHomeReadSnapshots: jest.fn(),
}));

jest.mock('@/contexts/ThemeContext', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/contexts/CategoryContext', () => ({
  CategoryProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/contexts/LedgerReadModelContext', () => ({
  LedgerReadModelProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/contexts/AppDialogContext', () => ({
  AppDialogProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/components/HouseholdGuard', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

import { AuthenticatedPlatformEffects } from '@/components/AppProviders';
import { refreshAndroidHostSession } from '@/platform/android-host/androidHostBridge';

const mockRefreshAndroidHostSession = refreshAndroidHostSession as jest.MockedFunction<
  typeof refreshAndroidHostSession
>;

describe('Android native 복귀 원격 읽기 갱신 계약', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefreshAndroidHostSession.mockResolvedValue(undefined);
  });

  it('검증된 Android 세션은 첫 원장 paint를 기다리지 않고 FID 등록 동기화를 시작한다', () => {
    const staleMarker = JSON.stringify({
      bindingKey: 'uid-1\u0000household-1\u0000member-1',
      refreshedAt: Date.now(),
    });
    window.localStorage.setItem('household-account.native-session-refresh.v2', staleMarker);

    const view = render(<AuthenticatedPlatformEffects />);

    expect(mockRefreshAndroidHostSession).toHaveBeenCalledTimes(1);
    expect(mockRefreshAndroidHostSession).toHaveBeenCalledWith({
      householdId: 'household-1',
      memberId: 'member-1',
    });
    expect(window.localStorage.getItem('household-account.native-session-refresh.v2'))
      .toBe(staleMarker);

    view.unmount();
    window.localStorage.removeItem('household-account.native-session-refresh.v2');
  });

  it('동시 재시도는 합치고 실패가 끝난 뒤 native resume에서 다시 시도한다', async () => {
    let rejectFirst!: (error: Error) => void;
    mockRefreshAndroidHostSession.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    }));
    const view = render(<AuthenticatedPlatformEffects />);

    act(() => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('household-account:android-resume'));
    });
    expect(mockRefreshAndroidHostSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectFirst(new Error('temporary'));
      await Promise.resolve();
    });
    act(() => {
      window.dispatchEvent(new Event('household-account:android-resume'));
    });
    expect(mockRefreshAndroidHostSession).toHaveBeenCalledTimes(2);

    view.unmount();
  });

  it('native resume는 인증 갱신 제한만 확인하고 전역 읽기 epoch를 직접 변경하지 않는다', () => {
    const view = render(<AuthenticatedPlatformEffects />);

    act(() => {
      window.dispatchEvent(new Event('household-account:android-resume'));
    });

    expect(recoverRemoteSession).not.toHaveBeenCalled();

    view.unmount();
    act(() => {
      window.dispatchEvent(new Event('household-account:android-resume'));
    });
    expect(recoverRemoteSession).not.toHaveBeenCalled();
  });

  it('첫 원장 paint 이후 idle 작업으로 주요 내부 route를 미리 받는다', () => {
    const view = render(<AuthenticatedPlatformEffects />);
    const routePrefetchTask = mockScheduleAfterWebFirstLedgerPaint.mock.calls
      .find(([, options]) => options?.idleTimeoutMs === 10_000)?.[0];

    expect(routePrefetchTask).toBeDefined();
    expect(mockRoutePrefetch).not.toHaveBeenCalled();

    act(() => {
      routePrefetchTask?.();
    });
    expect(mockRoutePrefetch.mock.calls.map(([route]) => route)).toEqual([
      '/income',
      '/assets',
      '/settings',
      '/stats',
    ]);

    view.unmount();
  });
});
