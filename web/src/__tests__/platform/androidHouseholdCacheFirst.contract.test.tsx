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

jest.mock('@/features/access-household/application/signedInMembershipCache', () => ({
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
import { activatePwaFidEndpoint } from '@/platform/pwa/fidEndpointLifecycle';
import { setClientSessionScope } from '@/composition/clientSessionScope';
import {
  clearAdminHouseholdViewSelection,
  selectAdminHouseholdView,
} from '@/features/access-household/application/adminHouseholdViewSelection';
import {
  readSignedInHouseholdCache,
  readSignedInMembershipCache,
} from '@/features/access-household/application/signedInMembershipCache';

const mockGetCachedHousehold = jest.mocked(getCachedHousehold);
const mockGetHousehold = jest.mocked(getHousehold);
const mockOnAuthChange = jest.mocked(onAuthChange);
const mockRestoreAndroidHostAuth = jest.mocked(restoreAndroidHostAuth);
const mockResolveSignedInUser = jest.mocked(householdCommands.resolveSignedInUser);
const mockActivatePwaFidEndpoint = jest.mocked(activatePwaFidEndpoint);
const mockSetClientSessionScope = jest.mocked(setClientSessionScope);
const mockReadSignedInHouseholdCache = jest.mocked(readSignedInHouseholdCache);
const mockReadSignedInMembershipCache = jest.mocked(readSignedInMembershipCache);

function SessionProbe() {
  const { household, sessionState } = useHousehold();
  return <div>{`${sessionState}:${household?.name ?? 'none'}`}</div>;
}

function AdminSessionProbe() {
  const { household, sessionState, adminHouseholdView, currentMember } = useHousehold();
  return (
    <div>{`${sessionState}:${household?.name ?? 'none'}:${adminHouseholdView?.householdId ?? 'member'}:${currentMember?.id ?? 'no-member'}`}</div>
  );
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
    window.history.replaceState({}, '', '/');
    clearAdminHouseholdViewSelection();
    mockAndroidHostAvailable = false;
    mockReadSignedInHouseholdCache.mockReturnValue(undefined);
    mockReadSignedInMembershipCache.mockReturnValue(undefined);
    mockOnAuthChange.mockImplementation(() => jest.fn());
  });

  it('[T-ADM-003][ADM-004] systemAdmin은 대상 가구를 실제 가구원으로 가장하지 않고 조회 전용으로 연다', async () => {
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
    mockGetHousehold.mockResolvedValue(household('관리 대상 가계부'));

    render(
      <HouseholdProvider>
        <AdminSessionProbe />
      </HouseholdProvider>,
    );

    expect(
      await screen.findByText('ready:관리 대상 가계부:household-1:no-member')
    ).toBeInTheDocument();
    expect(mockResolveSignedInUser).not.toHaveBeenCalled();
    expect(mockActivatePwaFidEndpoint).not.toHaveBeenCalled();
    expect(mockSetClientSessionScope).toHaveBeenCalledWith(expect.objectContaining({
      principalUid: 'uid-admin',
      householdId: 'household-1',
      memberId: 'system-administrator',
      accessMode: 'administrator-readonly',
    }));
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
    expect(mockActivatePwaFidEndpoint).toHaveBeenCalledTimes(1);
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

  it('Android 재실행은 영속 Auth와 검증 Membership cache로 Native 재교환보다 먼저 화면을 연다', async () => {
    mockAndroidHostAvailable = true;
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
    mockReadSignedInMembershipCache.mockReturnValue(cachedResolution);
    mockOnAuthChange.mockImplementation((listener) => {
      listener({ uid: 'uid-1' } as User);
      return jest.fn();
    });
    mockReadSignedInHouseholdCache.mockReturnValue(household('즉시 복원 가계부'));
    mockGetHousehold.mockReturnValue(new Promise(() => {}));

    render(
      <HouseholdProvider>
        <SessionProbe />
      </HouseholdProvider>,
    );

    expect(await screen.findByText('ready:즉시 복원 가계부')).toBeInTheDocument();
    expect(mockResolveSignedInUser).not.toHaveBeenCalled();
    expect(mockRestoreAndroidHostAuth).not.toHaveBeenCalled();
    expect(mockGetCachedHousehold).not.toHaveBeenCalled();
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
