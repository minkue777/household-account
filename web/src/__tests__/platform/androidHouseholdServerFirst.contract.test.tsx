import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { User } from 'firebase/auth';

jest.mock('@/lib/householdService', () => ({
  getHousehold: jest.fn(),
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
    retryInitialization: jest.fn(),
    joinAsSelf: jest.fn(),
  },
}));

jest.mock('@/features/access-household/application/legacySessionCandidate', () => ({
  captureLegacySessionCandidate: jest.fn(),
  clearLegacySessionCandidate: jest.fn(),
}));

jest.mock('@/features/access-household/application/signedInMembershipCache', () => ({
  readSignedInMembershipCache: jest.fn(),
  writeSignedInMembershipCache: jest.fn(),
  clearSignedInMembershipCache: jest.fn(),
}));

jest.mock('@/composition/clientSessionScope', () => ({
  clearClientSessionScope: jest.fn(),
  setClientSessionScope: jest.fn(),
}));

const mockActivatePwaFidEndpoint = jest.fn().mockResolvedValue(false);
const mockRemovePwaFidEndpoint = jest.fn();
jest.mock('@/platform/pwa/fidEndpointLifecycle', () => {
  return {
    activatePwaFidEndpoint: mockActivatePwaFidEndpoint,
    removePwaFidEndpointForLogout: mockRemovePwaFidEndpoint,
  };
});

jest.mock('@/platform/pwa/sessionCache', () => ({
  clearPwaRuntimeCaches: jest.fn(),
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
import { getHousehold, renameHouseholdMember } from '@/lib/householdService';
import {
  onAuthChange,
  refreshAndroidWebAuth,
  restoreAndroidHostAuth,
  logOut,
} from '@/lib/authService';
import { captureLegacySessionCandidate, clearLegacySessionCandidate } from '@/features/access-household/application/legacySessionCandidate';
import { householdCommands } from '@/features/access-household/application/householdCommands';
import {
  clearSignedInMembershipCache,
  readSignedInMembershipCache,
  writeSignedInMembershipCache,
} from '@/features/access-household/application/signedInMembershipCache';
import {
  MEMBERSHIP_RESOLUTION_REQUESTED_EVENT,
} from '@/features/access-household/application/membershipResolutionRecovery';
import {
  clearAdminHouseholdViewSelection,
  selectAdminHouseholdView,
} from '@/features/access-household/application/adminHouseholdViewSelection';
import { markWebFirstLedgerPaint } from '@/platform/performance/webStartupPerformance';
import { DEFAULT_HOME_SUMMARY_CONFIG } from '@/types/household';

const mockGetHousehold = jest.mocked(getHousehold);
const mockRenameHouseholdMember = jest.mocked(renameHouseholdMember);
const mockOnAuthChange = jest.mocked(onAuthChange);
const mockRefreshAndroidWebAuth = jest.mocked(refreshAndroidWebAuth);
const mockRestoreAndroidHostAuth = jest.mocked(restoreAndroidHostAuth);
const mockResolveSignedInUser = jest.mocked(householdCommands.resolveSignedInUser);
const mockReadSignedInMembershipCache = jest.mocked(readSignedInMembershipCache);
const mockClearSignedInMembershipCache = jest.mocked(clearSignedInMembershipCache);
const mockWriteSignedInMembershipCache = jest.mocked(writeSignedInMembershipCache);

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

const cachedResolution = {
  ...resolution,
  household: {
    id: 'household-1',
    name: '저장된 가계부',
    createdAt: '2026-07-19T15:00:00.000Z',
    members: [{ id: 'member-1', name: '민규', aggregateVersion: 3 }],
  },
};

function household(name: string) {
  return {
    id: 'household-1',
    name,
    createdAt: new Date('2026-07-20T00:00:00+09:00'),
    homeSummaryConfig: { ...DEFAULT_HOME_SUMMARY_CONFIG },
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
    renameMember,
    createHouseholdForSelf,
    retrySession,
    confirmLegacyMembership,
    logout,
    sessionError,
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
      <output data-testid={'session-error'}>{sessionError}</output>
      <button onClick={() => void createHouseholdForSelf('우리집', '사용자').catch(() => {})}>create</button>
      <button onClick={() => void retrySession().catch(() => {})}>retry</button>
      <button onClick={() => void confirmLegacyMembership().catch(() => {})}>claim</button>
      <button onClick={() => void logout().catch(() => {})}>logout</button>
      <output data-testid={'member-state'}>
        {currentMember
          ? `${currentMember.name}:${currentMember.aggregateVersion}`
          : 'no-member'}
      </output>
      <button
        type={'button'}
        onClick={() => {
          if (currentMember) void renameMember(currentMember.id, '새 이름');
        }}
      >
        rename
      </button>
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
    mockOnAuthChange.mockImplementation(() => jest.fn());
    mockRefreshAndroidWebAuth.mockImplementation(async (user) => ({ user }));
    mockRenameHouseholdMember.mockResolvedValue(undefined);
    jest.mocked(captureLegacySessionCandidate).mockReturnValue(undefined);
    mockRemovePwaFidEndpoint.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('[HH-007] 생성 graph를 유지하고 실패한 초기화만 다시 시도하여 서버 설정으로 복구한다', async () => {
    mockOnAuthChange.mockImplementation((listener) => { listener({ uid: 'uid-new' } as User); return jest.fn(); });
    mockResolveSignedInUser.mockResolvedValueOnce({ kind: 'first-visit-required', choices: ['create', 'join'] });
    jest.mocked(householdCommands.createWithSelf).mockResolvedValue({ householdId: 'household-1', memberId: 'member-1', initializationStatus: 'failed' });
    render(<HouseholdProvider><Probe /></HouseholdProvider>);
    await screen.findByText('first-visit:none:member:no-member:unverified');
    fireEvent.click(screen.getByRole('button', { name: 'create' }));
    await screen.findByText('error:none:member:no-member:unverified');
    expect(screen.getByTestId('session-error')).toHaveTextContent('초기화에 실패');
    mockResolveSignedInUser.mockResolvedValue({ ...cachedResolution, household: { ...cachedResolution.household, initializationStatus: 'failed' } });
    jest.mocked(householdCommands.retryInitialization).mockResolvedValue({ initializationStatus: 'completed' });
    mockGetHousehold.mockResolvedValue({ ...household('복구된 가계부'), initializationStatus: 'completed', categoryCatalogVersion: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await screen.findByText('ready:복구된 가계부:member:member-1:verified');
    expect(householdCommands.createWithSelf).toHaveBeenCalledTimes(1);
    expect(householdCommands.retryInitialization).toHaveBeenCalledWith('household-1');
    expect(mockWriteSignedInMembershipCache).toHaveBeenLastCalledWith('uid-new', expect.objectContaining({ household: expect.objectContaining({ initializationStatus: 'completed', categoryCatalogVersion: 1 }) }));
  });

  it.each(['LEGACY_MEMBERSHIP_NOT_FOUND', 'LEGACY_CLAIM_DISABLED'])('[HH-003] 무효한 기존 후보(%s)는 제거하고 첫 방문으로 돌아간다', async (code) => {
    mockOnAuthChange.mockImplementation((listener) => { listener({ uid: 'uid-new' } as User); return jest.fn(); });
    jest.mocked(captureLegacySessionCandidate).mockReturnValue({ legacyHouseholdId: 'old', legacyMemberId: 'missing' });
    mockResolveSignedInUser.mockResolvedValue({ kind: 'first-visit-required', choices: ['create', 'join'] });
    jest.mocked(householdCommands.claimLegacyMembership).mockRejectedValue(Object.assign(new Error(code), { code }));
    render(<HouseholdProvider><Probe /></HouseholdProvider>);
    await screen.findByText('legacy-confirmation:none:member:no-member:unverified');
    fireEvent.click(screen.getByRole('button', { name: 'claim' }));
    await screen.findByText('first-visit:none:member:no-member:unverified');
    expect(clearLegacySessionCandidate).toHaveBeenCalled();
  });

  it('[PWA-004] endpoint 제거 실패 시 Auth 로그아웃과 로컬 세션 삭제를 시작하지 않는다', async () => {
    iosPwa = true;
    mockOnAuthChange.mockImplementation((listener) => { listener({ uid: 'uid-1' } as User); return jest.fn(); });
    mockResolveSignedInUser.mockResolvedValue(cachedResolution);
    mockRemovePwaFidEndpoint.mockRejectedValue(new Error('endpoint unavailable'));
    render(<HouseholdProvider><Probe /></HouseholdProvider>);
    await screen.findByText('ready:저장된 가계부:member:member-1:verified');
    fireEvent.click(screen.getByRole('button', { name: 'logout' }));
    await waitFor(() => expect(mockRemovePwaFidEndpoint).toHaveBeenCalledTimes(1));
    expect(logOut).not.toHaveBeenCalled();
    expect(screen.getByText('ready:저장된 가계부:member:member-1:verified')).toBeInTheDocument();
    expect(screen.getByTestId('session-error')).toHaveTextContent('다시 로그아웃');
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

  it('Membership cache가 없으면 token refresh 없이 권위 Membership 복원을 한 번만 시작한다', async () => {
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
    expect(screen.getByText('ready:우리집:member:member-1:verified'))
      .toBeInTheDocument();
    expect(screen.getByTestId('household-key')).toHaveTextContent('household-1');
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
    mockResolveSignedInUser.mockResolvedValue({ kind: 'first-visit-required', choices: ['create', 'join'] });
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

  it('[T-WEBVIEW-004][AND-012] 저장된 Membership으로 즉시 사용할 수 있고 가구 표시 정보만 백그라운드 갱신한다', async () => {
    androidHostAvailable = true;
    let resolveHousehold!: (value: ReturnType<typeof household>) => void;
    mockReadSignedInMembershipCache.mockReturnValue(cachedResolution);
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

    expect(await screen.findByText(
      'ready:저장된 가계부:member:member-1:verified'
    )).toBeInTheDocument();
    expect(mockResolveSignedInUser).not.toHaveBeenCalled();
    expect(screen.getByTestId('household-key')).toHaveTextContent('household-1');
    await waitFor(() => expect(mockGetHousehold).toHaveBeenCalledTimes(1));
    expect(screen.getByText('ready:저장된 가계부:member:member-1:verified'))
      .toBeInTheDocument();

    await act(async () => {
      resolveHousehold(household('서버 최신 가계부'));
    });
    expect(await screen.findByText(
      'ready:서버 최신 가계부:member:member-1:verified'
    )).toBeInTheDocument();
    expect(mockResolveSignedInUser).not.toHaveBeenCalled();
  });

  it('cache와 같은 가구 metadata를 다시 읽으면 화면 cache를 다시 기록하지 않는다', async () => {
    androidHostAvailable = true;
    mockReadSignedInMembershipCache.mockReturnValue(cachedResolution);
    mockOnAuthChange.mockImplementation((listener) => {
      listener({ uid: 'uid-1' } as User);
      return jest.fn();
    });
    mockGetHousehold.mockResolvedValue(household(cachedResolution.household.name));

    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );

    expect(await screen.findByText(
      `ready:${cachedResolution.household.name}:member:member-1:verified`
    )).toBeInTheDocument();
    await waitFor(() => expect(mockGetHousehold).toHaveBeenCalledTimes(1));
    expect(mockWriteSignedInMembershipCache).not.toHaveBeenCalled();
  });

  it('가구 metadata 응답보다 먼저 이름 변경이 끝나면 이전 member version으로 되돌리지 않는다', async () => {
    let resolveHousehold!: (value: ReturnType<typeof household>) => void;
    mockReadSignedInMembershipCache.mockReturnValue(cachedResolution);
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

    expect(await screen.findByText(
      'ready:저장된 가계부:member:member-1:verified'
    )).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'rename' }));
    await waitFor(() => {
      expect(screen.getByTestId('member-state')).toHaveTextContent('새 이름:4');
    });

    await act(async () => {
      resolveHousehold(household('저장된 가계부'));
    });

    expect(screen.getByTestId('member-state')).toHaveTextContent('새 이름:4');
    expect(mockWriteSignedInMembershipCache).toHaveBeenLastCalledWith(
      'uid-1',
      expect.objectContaining({
        membership: expect.objectContaining({
          displayName: '새 이름',
          aggregateVersion: 4,
        }),
        household: expect.objectContaining({
          members: expect.arrayContaining([
            expect.objectContaining({
              id: 'member-1',
              name: '새 이름',
              aggregateVersion: 4,
            }),
          ]),
        }),
      })
    );
  });

  it('permission 복구의 권위 조회가 일시 실패하면 화면을 유지하고 backoff로 다시 시도한다', async () => {
    const transientFailure = Object.assign(new Error('temporary outage'), {
      code: 'functions/unavailable',
    });
    const refreshedResolution = {
      ...resolution,
      household: {
        ...cachedResolution.household,
        name: '복구된 가계부',
      },
    };
    mockReadSignedInMembershipCache.mockReturnValue(cachedResolution);
    mockOnAuthChange.mockImplementation((listener) => {
      listener({ uid: 'uid-1' } as User);
      return jest.fn();
    });
    mockGetHousehold.mockResolvedValue(household(cachedResolution.household.name));
    mockResolveSignedInUser
      .mockRejectedValueOnce(transientFailure)
      .mockResolvedValueOnce(refreshedResolution);

    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );
    expect(await screen.findByText(
      'ready:저장된 가계부:member:member-1:verified'
    )).toBeInTheDocument();

    jest.useFakeTimers();
    await act(async () => {
      window.dispatchEvent(new Event(MEMBERSHIP_RESOLUTION_REQUESTED_EVENT));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockResolveSignedInUser).toHaveBeenCalledTimes(1);
    expect(screen.getByText(
      'ready:저장된 가계부:member:member-1:verified'
    )).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(2_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockResolveSignedInUser).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(
      'ready:복구된 가계부:member:member-1:verified'
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

    expect(await screen.findByText(
      'ready:우리집:member:member-1:verified'
    )).toBeInTheDocument();
    expect(mockResolveSignedInUser).not.toHaveBeenCalled();
    await waitFor(() => expect(mockGetHousehold).toHaveBeenCalledTimes(1));
    expect(screen.getByText('ready:우리집:member:member-1:verified'))
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

  it('permission-denied 복구 신호는 현재 화면을 유지하며 권위 Membership을 한 번만 다시 해석한다', async () => {
    androidHostAvailable = true;
    const refreshedResolution = {
      ...resolution,
      membership: {
        ...resolution.membership,
        displayName: '새 이름',
        aggregateVersion: 4,
      },
      household: {
        id: 'household-1',
        name: '권위 재확인 가계부',
        createdAt: '2026-07-20T00:00:00.000Z',
        members: [{ id: 'member-1', name: '새 이름', aggregateVersion: 4 }],
      },
    };
    mockReadSignedInMembershipCache.mockReturnValue(cachedResolution);
    mockOnAuthChange.mockImplementation((listener) => {
      listener({ uid: 'uid-1' } as User);
      return jest.fn();
    });
    mockGetHousehold.mockResolvedValue(household('서버 최신 가계부'));
    let finishResolution!: (value: typeof refreshedResolution) => void;
    mockResolveSignedInUser.mockReturnValue(new Promise((resolve) => {
      finishResolution = resolve;
    }));

    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );

    expect(await screen.findByText(
      'ready:서버 최신 가계부:member:member-1:verified'
    )).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event(MEMBERSHIP_RESOLUTION_REQUESTED_EVENT));
      window.dispatchEvent(new Event(MEMBERSHIP_RESOLUTION_REQUESTED_EVENT));
    });
    await waitFor(() => expect(mockResolveSignedInUser).toHaveBeenCalledTimes(1));
    expect(mockClearSignedInMembershipCache).toHaveBeenCalledTimes(1);
    expect(screen.getByText(
      'ready:서버 최신 가계부:member:member-1:verified'
    )).toBeInTheDocument();

    await act(async () => {
      finishResolution(refreshedResolution);
    });
    expect(await screen.findByText(
      'ready:권위 재확인 가계부:member:member-1:verified'
    )).toBeInTheDocument();
    expect(mockResolveSignedInUser).toHaveBeenCalledTimes(1);
  });

  it('사용자 A의 권한 복구 중 UID가 B로 바뀌면 B의 복구를 A의 in-flight 상태가 막지 않는다', async () => {
    let authListener!: (user: User | null) => void;
    let finishFirstResolution!: (value: typeof cachedResolution) => void;
    const cachedResolutionB = {
      kind: 'membership-found' as const,
      membership: {
        householdId: 'household-2',
        memberId: 'member-2',
        displayName: '진선',
        aggregateVersion: 1,
        status: 'active' as const,
        capabilities: ['household.read'],
      },
      household: {
        id: 'household-2',
        name: 'B 가계부',
        createdAt: '2026-07-20T00:00:00.000Z',
        members: [{ id: 'member-2', name: '진선', aggregateVersion: 1 }],
      },
    };
    mockOnAuthChange.mockImplementation((listener) => {
      authListener = listener;
      listener({ uid: 'uid-a' } as User);
      return jest.fn();
    });
    mockReadSignedInMembershipCache.mockImplementation((uid) =>
      uid === 'uid-a' ? cachedResolution : cachedResolutionB
    );
    mockGetHousehold.mockImplementation(async (householdId) =>
      householdId === 'household-1'
        ? household(cachedResolution.household.name)
        : {
            id: 'household-2',
            name: 'B 가계부',
            createdAt: new Date('2026-07-20T00:00:00.000Z'),
            homeSummaryConfig: { ...DEFAULT_HOME_SUMMARY_CONFIG },
            members: [{ id: 'member-2', name: '진선', aggregateVersion: 1 }],
          }
    );
    mockResolveSignedInUser
      .mockReturnValueOnce(new Promise((resolve) => {
        finishFirstResolution = resolve;
      }))
      .mockResolvedValueOnce(cachedResolutionB);

    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );
    expect(await screen.findByText(
      'ready:저장된 가계부:member:member-1:verified'
    )).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event(MEMBERSHIP_RESOLUTION_REQUESTED_EVENT));
    });
    await waitFor(() => expect(mockResolveSignedInUser).toHaveBeenCalledTimes(1));

    await act(async () => {
      authListener({ uid: 'uid-b' } as User);
    });
    expect(await screen.findByText(
      'ready:B 가계부:member:member-2:verified'
    )).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event(MEMBERSHIP_RESOLUTION_REQUESTED_EVENT));
    });
    await waitFor(() => expect(mockResolveSignedInUser).toHaveBeenCalledTimes(2));

    await act(async () => {
      finishFirstResolution(cachedResolution);
    });
    expect(screen.getByText(
      'ready:B 가계부:member:member-2:verified'
    )).toBeInTheDocument();
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
    expect(mockActivatePwaFidEndpoint).not.toHaveBeenCalled();

    act(() => markWebFirstLedgerPaint());
    await waitFor(() => expect(mockActivatePwaFidEndpoint).toHaveBeenCalledTimes(1));
  });
});
