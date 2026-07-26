import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { User } from 'firebase/auth';

jest.mock('@/lib/householdService', () => ({
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
} from '@/lib/authService';
import { readSignedInMembershipCache } from '@/features/access-household/application/signedInMembershipCache';

const mockOnAuthChange = jest.mocked(onAuthChange);
const mockRefreshAndroidWebAuth = jest.mocked(refreshAndroidWebAuth);
const mockGetHousehold = jest.mocked(getHousehold);
const mockReadSignedInMembershipCache = jest.mocked(readSignedInMembershipCache);

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
    mockReadSignedInMembershipCache.mockReturnValue(resolution);
    mockGetHousehold.mockResolvedValue({
      id: 'household-1',
      name: '서버 가계부',
      createdAt: new Date('2026-07-20T00:00:00+09:00'),
      members: [{ id: 'member-1', name: '민규', aggregateVersion: 3 }],
    });
    mockRefreshAndroidWebAuth.mockImplementation(async (user) => ({ user }));
  });

  it('같은 UID의 token callback은 오류로 종료된 listener를 위한 epoch를 전진시킨다', async () => {
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

    const first = await screen.findByText(/서버 가계부:verified:ready:\d+/);
    const firstEpoch = Number(first.textContent?.split(':').at(-1));
    await act(async () => {
      authListener?.({ uid: 'uid-1' } as User);
    });

    await waitFor(() => {
      const current = screen.getByText(/서버 가계부:verified:ready:\d+/);
      expect(Number(current.textContent?.split(':').at(-1)))
        .toBeGreaterThan(firstEpoch);
    });
  });
});
