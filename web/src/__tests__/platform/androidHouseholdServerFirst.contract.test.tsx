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

jest.mock('@/platform/pwa/fidEndpointLifecycle', () => ({
  activatePwaFidEndpoint: jest.fn().mockResolvedValue(false),
  removePwaFidEndpointForLogout: jest.fn(),
}));

jest.mock('@/platform/pwa/sessionCache', () => ({
  clearPwaRuntimeCaches: jest.fn(),
}));

let androidHostAvailable = false;
jest.mock('@/platform/android-host/androidHostBridge', () => ({
  isAndroidHostAvailable: () => androidHostAvailable,
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
    isSessionVerified,
  } = useHousehold();
  return (
    <div>
      {[
        sessionState,
        current?.name ?? 'none',
        adminHouseholdView?.householdId ?? 'member',
        currentMember?.id ?? 'no-member',
        isSessionVerified ? 'verified' : 'unverified',
      ].join(':')}
    </div>
  );
}

describe('Android 가계부 server-first 복원 계약', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    androidHostAvailable = false;
    window.history.replaceState({}, '', '/');
    clearAdminHouseholdViewSelection();
    mockReadSignedInMembershipCache.mockReturnValue(undefined);
    mockGetSignedInMembershipRevalidationDelay.mockReturnValue(undefined);
    mockOnAuthChange.mockImplementation(() => jest.fn());
    mockRefreshAndroidWebAuth.mockImplementation(async (user) => ({ user }));
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
    expect(screen.getByText('resolving:none:member:no-member:verified'))
      .toBeInTheDocument();
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
    expect(screen.getByText('resolving:none:member:no-member:verified'))
      .toBeInTheDocument();
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
  });
});
