import { act, render } from '@testing-library/react';

const recoverRemoteSession = jest.fn().mockResolvedValue(undefined);

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
  scheduleAfterWebFirstLedgerPaint: () => jest.fn(),
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
});
