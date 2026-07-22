import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { User } from 'firebase/auth';

jest.mock('@/lib/householdService', () => ({
  getCachedHousehold: jest.fn(),
  getHousehold: jest.fn(),
  HouseholdReadNotFoundError: class HouseholdReadNotFoundError extends Error {
    constructor(readonly householdId: string) {
      super('HOUSEHOLD_READ_NOT_FOUND');
    }
  },
  renameHouseholdMember: jest.fn(),
}));

jest.mock('@/lib/authService', () => ({
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

jest.mock('@/composition/clientSessionScope', () => ({
  clearClientSessionScope: jest.fn(),
  setClientSessionScope: jest.fn(),
}));

jest.mock('@/platform/pwa/fidEndpointLifecycle', () => ({
  removePwaFidEndpointForLogout: jest.fn(),
}));

jest.mock('@/platform/pwa/sessionCache', () => ({
  clearPwaRuntimeCaches: jest.fn(),
}));

let mockAndroidHostAvailable = false;
jest.mock('@/platform/android-host/androidHostBridge', () => ({
  isAndroidHostAvailable: () => mockAndroidHostAvailable,
}));

import { HouseholdProvider, useHousehold } from '@/contexts/HouseholdContext';
import {
  getCachedHousehold,
  getHousehold,
  HouseholdReadNotFoundError,
} from '@/lib/householdService';
import { onAuthChange, restoreAndroidHostAuth } from '@/lib/authService';
import { householdCommands } from '@/features/access-household/application/householdCommands';

const mockGetCachedHousehold = jest.mocked(getCachedHousehold);
const mockGetHousehold = jest.mocked(getHousehold);
const mockOnAuthChange = jest.mocked(onAuthChange);
const mockRestoreAndroidHostAuth = jest.mocked(restoreAndroidHostAuth);
const mockResolveSignedInUser = jest.mocked(householdCommands.resolveSignedInUser);

function SessionProbe() {
  const { household, sessionState } = useHousehold();
  return <div>{`${sessionState}:${household?.name ?? 'none'}`}</div>;
}

const household = (name: string) => ({
  id: 'household-1',
  name,
  createdAt: new Date('2026-07-20T00:00:00+09:00'),
  members: [{ id: 'member-1', name: '민규', aggregateVersion: 3 }],
});

describe('Android 가구 cache-first 복원 계약', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAndroidHostAvailable = false;
    mockOnAuthChange.mockImplementation(() => jest.fn());
  });

  it('[T-WEBVIEW-004][AND-012] 검증된 Membership의 cache snapshot을 먼저 표시한 뒤 서버 snapshot으로 갱신한다', async () => {
    let resolveServerRead!: (value: ReturnType<typeof household>) => void;
    mockOnAuthChange.mockImplementation((listener) => {
      listener({ uid: 'uid-1' } as User);
      return jest.fn();
    });
    mockResolveSignedInUser.mockResolvedValue({
      kind: 'membership-found',
      membership: {
        householdId: 'household-1',
        memberId: 'member-1',
        displayName: '민규',
        aggregateVersion: 3,
        status: 'active',
        capabilities: ['household.read'],
      },
    });
    mockGetCachedHousehold.mockResolvedValue(household('캐시 가계부'));
    mockGetHousehold.mockReturnValue(
      new Promise<ReturnType<typeof household>>((resolve) => {
        resolveServerRead = resolve;
      }),
    );

    render(
      <HouseholdProvider>
        <SessionProbe />
      </HouseholdProvider>,
    );

    expect(await screen.findByText('ready:캐시 가계부')).toBeInTheDocument();

    resolveServerRead(household('서버 가계부'));
    await waitFor(() => {
      expect(screen.getByText('ready:서버 가계부')).toBeInTheDocument();
    });
  });

  it('Android prefetched Membership은 별도 Membership 왕복 없이 cache 화면을 먼저 연다', async () => {
    mockAndroidHostAvailable = true;
    let resolveServerRead!: (value: ReturnType<typeof household>) => void;
    const signedInUserResolution = {
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
    mockRestoreAndroidHostAuth.mockResolvedValue({
      user: { uid: 'uid-1' } as never,
      signedInUserResolution,
    });
    mockGetCachedHousehold.mockResolvedValue(household('캐시 가계부'));
    mockGetHousehold.mockReturnValue(
      new Promise<ReturnType<typeof household>>((resolve) => {
        resolveServerRead = resolve;
      }),
    );

    render(
      <HouseholdProvider>
        <SessionProbe />
      </HouseholdProvider>,
    );

    expect(await screen.findByText('ready:캐시 가계부')).toBeInTheDocument();
    expect(mockResolveSignedInUser).not.toHaveBeenCalled();

    resolveServerRead(household('서버 가계부'));
    await waitFor(() => {
      expect(screen.getByText('ready:서버 가계부')).toBeInTheDocument();
    });
  });

  it('authoritative household not-found는 cache로 숨기지 않는다', async () => {
    mockAndroidHostAvailable = true;
    mockRestoreAndroidHostAuth.mockResolvedValue({
      user: { uid: 'uid-1' } as never,
      signedInUserResolution: {
        kind: 'membership-found',
        membership: {
          householdId: 'household-1',
          memberId: 'member-1',
          displayName: '민규',
          aggregateVersion: 3,
          status: 'active',
          capabilities: ['household.read'],
        },
      },
    });
    mockGetCachedHousehold.mockResolvedValue(household('삭제 전 캐시'));
    mockGetHousehold.mockRejectedValue(new HouseholdReadNotFoundError('household-1'));

    render(
      <HouseholdProvider>
        <SessionProbe />
      </HouseholdProvider>,
    );

    expect(await screen.findByText('error:none')).toBeInTheDocument();
  });

  it('일시적인 Firestore transport 장애만 cache ready 상태로 흡수한다', async () => {
    mockAndroidHostAvailable = true;
    mockRestoreAndroidHostAuth.mockResolvedValue({
      user: { uid: 'uid-1' } as never,
      signedInUserResolution: {
        kind: 'membership-found',
        membership: {
          householdId: 'household-1',
          memberId: 'member-1',
          displayName: '민규',
          aggregateVersion: 3,
          status: 'active',
          capabilities: ['household.read'],
        },
      },
    });
    mockGetCachedHousehold.mockResolvedValue(household('오프라인 캐시'));
    mockGetHousehold.mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }));

    render(
      <HouseholdProvider>
        <SessionProbe />
      </HouseholdProvider>,
    );

    expect(await screen.findByText('ready:오프라인 캐시')).toBeInTheDocument();
    expect(mockResolveSignedInUser).not.toHaveBeenCalled();
  });
});
