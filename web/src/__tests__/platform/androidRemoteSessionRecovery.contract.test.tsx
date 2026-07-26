import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { User } from 'firebase/auth';

jest.mock('@/lib/householdService', () => ({
  getCachedHousehold: jest.fn(),
  getHousehold: jest.fn(),
  renameHouseholdMember: jest.fn(),
}));

jest.mock('@/lib/authService', () => ({
  getCurrentUser: jest.fn(),
  refreshAndroidWebAuth: jest.fn(),
  restoreAndroidHostAuth: jest.fn(),
  logOut: jest.fn(),
  onAuthChange: jest.fn(),
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
  getSignedInMembershipRevalidationDelay: jest.fn(() => undefined),
  invalidateSignedInMembershipVerification: jest.fn(),
  readLastSignedInSessionCache: jest.fn(),
  readSignedInHouseholdCache: jest.fn(),
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

jest.mock('@/platform/android-host/androidHostBridge', () => ({
  isAndroidHostAvailable: () => true,
}));

import { HouseholdProvider, useHousehold } from '@/contexts/HouseholdContext';
import { getHousehold } from '@/lib/householdService';
import {
  onAuthChange,
  refreshAndroidWebAuth,
  restoreAndroidHostAuth,
} from '@/lib/authService';
import {
  readLastSignedInSessionCache,
  readSignedInHouseholdCache,
  readSignedInMembershipCache,
} from '@/features/access-household/application/signedInMembershipCache';

const mockOnAuthChange = jest.mocked(onAuthChange);
const mockRefreshAndroidWebAuth = jest.mocked(refreshAndroidWebAuth);
const mockRestoreAndroidHostAuth = jest.mocked(restoreAndroidHostAuth);
const mockGetHousehold = jest.mocked(getHousehold);
const mockReadLastSignedInSessionCache = jest.mocked(readLastSignedInSessionCache);
const mockReadSignedInHouseholdCache = jest.mocked(readSignedInHouseholdCache);
const mockReadSignedInMembershipCache = jest.mocked(readSignedInMembershipCache);

const cachedResolution = {
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

const cachedHousehold = {
  id: 'household-1',
  name: '마지막 검증 가계부',
  createdAt: new Date('2026-07-20T00:00:00+09:00'),
  members: [{ id: 'member-1', name: '민규', aggregateVersion: 3 }],
};

function Probe() {
  const {
    household,
    isSessionVerified,
    remoteSessionStatus,
    remoteReadEpoch,
  } = useHousehold();
  return (
    <div>
      {`${household?.name ?? 'none'}:${isSessionVerified ? 'verified' : 'unverified'}:${remoteSessionStatus}:${remoteReadEpoch}`}
    </div>
  );
}

describe('Android 원격 세션 복구 계약', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadLastSignedInSessionCache.mockReturnValue({
      principalUid: 'uid-1',
      resolution: cachedResolution,
      household: cachedHousehold,
    });
    mockReadSignedInMembershipCache.mockReturnValue(cachedResolution);
    mockReadSignedInHouseholdCache.mockReturnValue(cachedHousehold);
    mockGetHousehold.mockReturnValue(new Promise(() => {}));
    mockRefreshAndroidWebAuth.mockImplementation(async (user) => ({ user }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('native 복구 실패를 숨기지 않고 다음 성공에서 원격 구독 epoch를 연다', async () => {
    jest.useFakeTimers();
    mockOnAuthChange.mockImplementation((listener) => {
      listener(null);
      return jest.fn();
    });
    mockRestoreAndroidHostAuth
      .mockRejectedValueOnce(new Error('temporary native auth failure'))
      .mockResolvedValueOnce({
        user: { uid: 'uid-1' } as never,
        signedInUserResolution: cachedResolution,
      });

    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );

    await act(async () => {
      jest.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(/마지막 검증 가계부:unverified:degraded:0/))
      .toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(5_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByText(/마지막 검증 가계부:verified:ready:[1-9]\d*/))
        .toBeInTheDocument();
    });
  });

  it('같은 UID의 token callback도 종료된 listener를 위한 epoch를 전진시킨다', async () => {
    let authListener: ((user: User | null) => void) | undefined;
    mockOnAuthChange.mockImplementation((listener) => {
      authListener = listener;
      listener({ uid: 'uid-1' } as User);
      return jest.fn();
    });

    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );

    const first = await screen.findByText(/마지막 검증 가계부:verified:ready:\d+/);
    const firstEpoch = Number(first.textContent?.split(':').at(-1));
    await act(async () => {
      authListener?.({ uid: 'uid-1' } as User);
    });

    await waitFor(() => {
      const current = screen.getByText(/마지막 검증 가계부:verified:ready:\d+/);
      expect(Number(current.textContent?.split(':').at(-1)))
        .toBeGreaterThan(firstEpoch);
    });
  });
});
