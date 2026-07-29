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

describe('Android native 복귀 원격 읽기 갱신 계약', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
