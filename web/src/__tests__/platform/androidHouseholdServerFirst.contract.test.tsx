import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { User } from 'firebase/auth';

jest.mock('@/lib/householdService', () => ({
  getHousehold: jest.fn(),
  HouseholdReadNotFoundError: class HouseholdReadNotFoundError extends Error {
    constructor(readonly householdId: string) {
      super('HOUSEHOLD_READ_NOT_FOUND');
      this.name = 'HouseholdReadNotFoundError';
    }
  },
  renameHouseholdMember: jest.fn(),
}));

jest.mock('@/lib/authService', () => ({
  refreshAndroidWebAuth: jest.fn(),
  logOut: jest.fn(),
  onAuthChange: jest.fn(),
  restoreAndroidHostAuth: jest.fn(),
  signInWithGoogleSession: jest.fn(),
}));

jest.mock('@/features/access-household/application/householdCommands', () => ({
  householdCommands: {
    resolveSignedInUser: jest.fn(),
    claimLegacyMembership: jest.fn(),
    createWithSelf: jest.fn(),
    joinAsSelf: jest.fn(),
  },
}));

jest.mock('@/features/access-household/application/legacySessionCandidate', () => ({
  captureLegacySessionCandidate: () => undefined,
  clearLegacySessionCandidate: jest.fn(),
}));

jest.mock('@/features/access-household/application/signedInMembershipCache', () => ({
  getSignedInMembershipRevalidationDelay: jest.fn(),
  invalidateSignedInMembershipVerification: jest.fn(),
  readSignedInMembershipCache: jest.fn(),
  writeSignedInMembershipCache: jest.fn(),
  clearSignedInMembershipCache: jest.fn(),
}));

jest.mock('@/composition/clientSessionScope', () => ({
  clearClientSessionScope: jest.fn(),
  setClientSessionScope: jest.fn(),
}));

const mockPwaModuleLoaded = jest.fn();
const mockActivatePwaFidEndpoint = jest.fn().mockResolvedValue(false);
jest.mock('@/platform/pwa/fidEndpointLifecycle', () => {
  mockPwaModuleLoaded();
  return {
    activatePwaFidEndpoint: mockActivatePwaFidEndpoint,
    removePwaFidEndpointForLogout: jest.fn(),
  };
});

jest.mock('@/platform/pwa/sessionCache', () => ({
  clearPwaRuntimeCaches: jest.fn(),
}));

jest.mock('@/platform/security/firebaseAppCheck', () => ({
  initializeFirebaseAppCheck: jest.fn(),
}));

let androidHostAvailable = false;
jest.mock('@/platform/android-host/androidHostBridge', () => ({
  isAndroidHostAvailable: () => androidHostAvailable,
}));

let iosPwa = false;
jest.mock('@/lib/utils/platform', () => ({
  Platform: {
    isIOSPWA: () => iosPwa,
  },
}));

import { HouseholdProvider, useHousehold } from '@/contexts/HouseholdContext';
import {
  getHousehold,
  HouseholdReadNotFoundError,
} from '@/lib/householdService';
import {
  onAuthChange,
  refreshAndroidWebAuth,
  restoreAndroidHostAuth,
} from '@/lib/authService';
import { householdCommands } from '@/features/access-household/application/householdCommands';
import {
  getSignedInMembershipRevalidationDelay,
  readSignedInMembershipCache,
} from '@/features/access-household/application/signedInMembershipCache';
import {
  clearAdminHouseholdViewSelection,
  selectAdminHouseholdView,
} from '@/features/access-household/application/adminHouseholdViewSelection';
import { markWebFirstLedgerPaint } from '@/platform/performance/webStartupPerformance';

const mockGetHousehold = jest.mocked(getHousehold);
const mockOnAuthChange = jest.mocked(onAuthChange);
const mockRefreshAndroidWebAuth = jest.mocked(refreshAndroidWebAuth);
const mockRestoreAndroidHostAuth = jest.mocked(restoreAndroidHostAuth);
const mockResolveSignedInUser = jest.mocked(householdCommands.resolveSignedInUser);
const mockReadSignedInMembershipCache = jest.mocked(readSignedInMembershipCache);
const mockGetSignedInMembershipRevalidationDelay = jest.mocked(
  getSignedInMembershipRevalidationDelay
);

const resolution = {
  kind: 'membership-found' as const,
  membership: {
    householdId: 'household-1',
    memberId: 'member-1',
    displayName: '민규',
    aggregateVersion: 3,
    status: 'active' as const,
    capabilities: ['household.read'],
  },
};

function household(name: string) {
  return {
    id: 'household-1',
    name,
    createdAt: new Date('2026-07-20T00:00:00+09:00'),
    members: [{ id: 'member-1', name: '민규', aggregateVersion: 3 }],
  };
}

function Probe() {
  const {
    household: current,
    sessionState,
    adminHouseholdView,
    currentMember,
    householdKey,
    isSessionVerified,
  } = useHousehold();
  return (
    <>
      <div>
        {[
          sessionState,
          current?.name ?? 'none',
          adminHouseholdView?.householdId ?? 'member',
          currentMember?.id ?? 'no-member',
          isSessionVerified ? 'verified' : 'unverified',
        ].join(':')}
      </div>
      <output data-testid={'household-key'}>{householdKey ?? 'no-key'}</output>
    </>
  );
}

describe('Android 가계부 server-first 복원 계약', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    androidHostAvailable = false;
    iosPwa = false;
    window.history.replaceState({}, '', '/');
    clearAdminHouseholdViewSelection();
    mockReadSignedInMembershipCache.mockReturnValue(undefined);
    mockGetSignedInMembershipRevalidationDelay.mockReturnValue(undefined);
    mockOnAuthChange.mockImplementation(() => jest.fn());
    mockRefreshAndroidWebAuth.mockImplementation(async (user) => ({ user }));
  });

  it('Auth observer의 첫 결과 전에는 Native 인증을 시작하지 않는다', async () => {
    androidHostAvailable = true;
    let authListener: ((user: User | null) => void) | undefined;
    mockOnAuthChange.mockImplementation((listener) => {
      authListener = listener;
      return jest.fn();
    });
    mockRestoreAndroidHostAuth.mockResolvedValue(null);

    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );

    await waitFor(() => expect(mockOnAuthChange).toHaveBeenCalledTimes(1));
    expect(mockRestoreAndroidHostAuth).not.toHaveBeenCalled();
    expect(mockRefreshAndroidWebAuth).not.toHaveBeenCalled();

    await act(async () => {
      authListener?.(null);
    });
    await waitFor(() => expect(mockRestoreAndroidHostAuth).toHaveBeenCalledTimes(1));
  });

  it('Native custom-token 교환 중 observer가 먼저 깨어도 Membership을 중복 조회하지 않는다', async () => {
    androidHostAvailable = true;
    let authListener: ((user: User | null) => void) | undefined;
    let resolveNative!: (value: {
      user: User;
      signedInUserResolution: typeof resolution;
    }) => void;
    mockOnAuthChange.mockImplementation((listener) => {
      authListener = listener;
      listener(null);
      return jest.fn();
    });
    mockRestoreAndroidHostAuth.mockReturnValue(new Promise((resolve) => {
      resolveNative = resolve;
    }));
    mockGetHousehold.mockResolvedValue(household('Native 가계부'));

    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );

    await waitFor(() => expect(mockRestoreAndroidHostAuth).toHaveBeenCalledTimes(1));
    await act(async () => {
      authListener?.({ uid: 'uid-1' } as User);
    });
    expect(mockResolveSignedInUser).not.toHaveBeenCalled();

    await act(async () => {
      resolveNative({
        user: { uid: 'uid-1' } as User,
        signedInUserResolution: resolution,
      });
    });

    expect(await screen.findByText(
      'ready:Native 가계부:member:member-1:verified'
    )).toBeInTheDocument();
    expect(mockResolveSignedInUser).not.toHaveBeenCalled();
    expect(mockGetHousehold).toHaveBeenCalledTimes(1);
  });

  it('저장된 Web 사용자는 token refresh 없이 Membership 복원을 한 번만 시작한다', async () => {
    androidHostAvailable = true;
    let resolveHousehold!: (value: ReturnType<typeof household>) => void;
    mockResolveSignedInUser.mockResolvedValue(resolution);
    mockGetHousehold.mockReturnValue(new Promise((resolve) => {
      resolveHousehold = resolve;
    }));
    mockOnAuthChange.mockImplementation((listener) => {
      listener({ uid: 'uid-1' } as User);
      return jest.fn();
    });

    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );

    await waitFor(() => expect(mockResolveSignedInUser).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockGetHousehold).toHaveBeenCalledTimes(1));
    expect(mockRefreshAndroidWebAuth).not.toHaveBeenCalled();
    expect(mockRestoreAndroidHostAuth).not.toHaveBeenCalled();
    expect(screen.getByText('resolving:none:member:member-1:verified'))
      .toBeInTheDocument();
    expect(screen.getByTestId('household-key')).toHaveTextContent('household-1');
    expect(mockPwaModuleLoaded).not.toHaveBeenCalled();
    expect(mockActivatePwaFidEndpoint).not.toHaveBeenCalled();

    await act(async () => {
      resolveHousehold(household('Membership 복원 가계부'));
    });
    expect(await screen.findByText(
      'ready:Membership 복원 가계부:member:member-1:verified'
    )).toBeInTheDocument();
  });

  it('저장된 Web 사용자의 첫 방문 상태도 Native 왕복 없이 확정한다', async () => {
    androidHostAvailable = true;
    mockResolveSignedInUser.mockResolvedValue({ kind: 'first-visit-required' });
    mockOnAuthChange.mockImplementation((listener) => {
      listener({ uid: 'uid-new' } as User);
      return jest.fn();
    });

    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );

    expect(await screen.findByText(
      'first-visit:none:member:no-member:unverified'
    )).toBeInTheDocument();
    expect(mockResolveSignedInUser).toHaveBeenCalledTimes(1);
    expect(mockRefreshAndroidWebAuth).not.toHaveBeenCalled();
    expect(mockRestoreAndroidHostAuth).not.toHaveBeenCalled();
  });

  it('[T-WEBVIEW-004][AND-012] 저장된 Membership이 있어도 최신 가구 서버 read 전에는 이전 화면을 표시하지 않는다', async () => {
    androidHostAvailable = true;
    let resolveHousehold!: (value: ReturnType<typeof household>) => void;
    mockReadSignedInMembershipCache.mockReturnValue(resolution);
    mockOnAuthChange.mockImplementation((listener) => {
      listener({ uid: 'uid-1' } as User);
      return jest.fn();
    });
    mockGetHousehold.mockReturnValue(new Promise((resolve) => {
      resolveHousehold = resolve;
    }));

    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );

    expect(screen.getByText('resolving:none:member:no-member:unverified'))
      .toBeInTheDocument();
    expect(mockResolveSignedInUser).not.toHaveBeenCalled();

    await waitFor(() => expect(mockGetHousehold).toHaveBeenCalledTimes(1));
    expect(screen.getByText('resolving:none:member:member-1:verified'))
      .toBeInTheDocument();
    expect(screen.getByTestId('household-key')).toHaveTextContent('household-1');
    await act(async () => {
      resolveHousehold(household('서버 최신 가계부'));
    });
    expect(await screen.findByText(
      'ready:서버 최신 가계부:member:member-1:verified'
    )).toBeInTheDocument();
  });

  it('Native가 Membership을 함께 반환해도 별도 Membership 왕복만 생략하고 가구 서버 read는 기다린다', async () => {
    androidHostAvailable = true;
    let resolveHousehold!: (value: ReturnType<typeof household>) => void;
    mockOnAuthChange.mockImplementation((listener) => {
      listener(null);
      return jest.fn();
    });
    mockRestoreAndroidHostAuth.mockResolvedValue({
      user: { uid: 'uid-1' } as never,
      signedInUserResolution: resolution,
    });
    mockGetHousehold.mockReturnValue(new Promise((resolve) => {
      resolveHousehold = resolve;
    }));

    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );

    expect(screen.getByText('resolving:none:member:no-member:unverified'))
      .toBeInTheDocument();
    expect(mockResolveSignedInUser).not.toHaveBeenCalled();

    await waitFor(() => expect(mockGetHousehold).toHaveBeenCalledTimes(1));
    expect(screen.getByText('resolving:none:member:member-1:verified'))
      .toBeInTheDocument();
    expect(screen.getByTestId('household-key')).toHaveTextContent('household-1');
    await act(async () => {
      resolveHousehold(household('Native 이후 최신 가계부'));
    });
    expect(await screen.findByText(
      'ready:Native 이후 최신 가계부:member:member-1:verified'
    )).toBeInTheDocument();
  });

  it('[T-ADM-003][ADM-004] 관리자의 가구 진입도 서버에서 읽은 가구만 조회 전용으로 표시한다', async () => {
    selectAdminHouseholdView({
      householdId: 'household-1',
      householdName: '선택 가계부',
    });
    mockOnAuthChange.mockImplementation((listener) => {
      listener({
        uid: 'uid-admin',
        getIdTokenResult: jest.fn().mockResolvedValue({
          claims: { systemAdmin: true },
        }),
      } as unknown as User);
      return jest.fn();
    });
    mockGetHousehold.mockResolvedValue(household('관리 서버 가계부'));

    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );

    expect(await screen.findByText(
      'ready:관리 서버 가계부:household-1:no-member:verified'
    )).toBeInTheDocument();
  });

  it('가구가 서버에 없거나 서버 read가 실패하면 과거 화면으로 숨기지 않는다', async () => {
    androidHostAvailable = true;
    mockOnAuthChange.mockImplementation((listener) => {
      listener(null);
      return jest.fn();
    });
    mockRestoreAndroidHostAuth.mockResolvedValue({
      user: { uid: 'uid-1' } as never,
      signedInUserResolution: resolution,
    });
    mockGetHousehold.mockRejectedValue(
      new HouseholdReadNotFoundError('household-1')
    );

    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('error:none:member:no-member:unverified'))
        .toBeInTheDocument();
    });
    expect(screen.getByTestId('household-key')).toHaveTextContent('no-key');
  });

  it('iOS PWA FID 모듈은 첫 장부 페인트 뒤에만 로드한다', async () => {
    iosPwa = true;
    mockReadSignedInMembershipCache.mockReturnValue(resolution);
    mockOnAuthChange.mockImplementation((listener) => {
      listener({ uid: 'uid-ios' } as User);
      return jest.fn();
    });
    mockGetHousehold.mockResolvedValue(household('iOS 가계부'));

    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );

    expect(await screen.findByText(
      'ready:iOS 가계부:member:member-1:verified'
    )).toBeInTheDocument();
    expect(mockPwaModuleLoaded).not.toHaveBeenCalled();
    expect(mockActivatePwaFidEndpoint).not.toHaveBeenCalled();

    act(() => markWebFirstLedgerPaint());
    await waitFor(() => expect(mockPwaModuleLoaded).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockActivatePwaFidEndpoint).toHaveBeenCalledTimes(1));
  });
});
