'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { User } from 'firebase/auth';
import {
  getCachedHousehold,
  getHousehold,
  HouseholdReadNotFoundError,
  renameHouseholdMember,
} from '@/lib/householdService';
import {
  logOut,
  onAuthChange,
  restoreAndroidHostAuth,
  signInWithGoogleSession,
} from '@/lib/authService';
import type { Household, HouseholdMember } from '@/types/household';
import { householdCommands } from '@/features/access-household/application/householdCommands';
import {
  captureLegacySessionCandidate,
  clearLegacySessionCandidate,
  type LegacySessionCandidate,
} from '@/features/access-household/application/legacySessionCandidate';
import {
  clearAdminHouseholdViewSelection,
  readAdminHouseholdViewSelection,
  type AdminHouseholdViewSelection,
} from '@/features/access-household/application/adminHouseholdViewSelection';
import {
  clearClientSessionScope,
  setClientSessionScope,
} from '@/composition/clientSessionScope';
import { resetClientOptimisticProjections } from '@/composition/resetClientOptimisticProjections';
import { clearPwaRuntimeCaches } from '@/platform/pwa/sessionCache';
import {
  OperationDeadlineExceededError,
  withinDeadline,
} from '@/platform/network/operationDeadline';
import {
  isAndroidHostAvailable,
} from '@/platform/android-host/androidHostBridge';
import {
  clearSignedInMembershipCache,
  readSignedInHouseholdCache,
  readSignedInMembershipCache,
  writeSignedInMembershipCache,
  type SignedInUserResolution,
} from '@/features/access-household/application/signedInMembershipCache';

const AUTH_BOOTSTRAP_TIMEOUT_MS = 60_000;
const SESSION_RESOLUTION_TIMEOUT_MS = 20_000;
const HOUSEHOLD_READ_TIMEOUT_MS = 20_000;

export type HouseholdSessionState =
  | 'resolving'
  | 'signed-out'
  | 'legacy-confirmation'
  | 'first-visit'
  | 'ready'
  | 'error';

interface HouseholdContextType {
  household: Household | null;
  householdKey: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  currentMember: HouseholdMember | null;
  sessionState: HouseholdSessionState;
  sessionError: string | null;
  legacyCandidate: LegacySessionCandidate | null;
  adminHouseholdView: AdminHouseholdViewSelection | null;
  signIn: () => Promise<void>;
  retrySession: () => Promise<void>;
  confirmLegacyMembership: () => Promise<void>;
  createHouseholdForSelf: (householdName: string, memberName: string) => Promise<void>;
  joinHouseholdAsSelf: (invitationCode: string, memberName: string) => Promise<void>;
  logout: () => Promise<void>;
  renameMember: (memberId: string, name: string) => Promise<void>;
}

const HouseholdContext = createContext<HouseholdContextType | undefined>(undefined);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '가계부 세션을 복원하지 못했습니다.';
}

const TRANSIENT_FIRESTORE_READ_CODES = new Set([
  'aborted',
  'cancelled',
  'deadline-exceeded',
  'network-request-failed',
  'unavailable',
  'firestore/aborted',
  'firestore/cancelled',
  'firestore/deadline-exceeded',
  'firestore/network-request-failed',
  'firestore/unavailable',
]);

function isTransientHouseholdReadFailure(error: unknown): boolean {
  if (error instanceof OperationDeadlineExceededError) return true;
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return TRANSIENT_FIRESTORE_READ_CODES.has(String((error as { code: unknown }).code));
}

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const [household, setHousehold] = useState<Household | null>(null);
  const [householdKey, setHouseholdKey] = useState<string | null>(null);
  const [currentMember, setCurrentMember] = useState<HouseholdMember | null>(null);
  const [sessionState, setSessionState] = useState<HouseholdSessionState>('resolving');
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [legacyCandidate, setLegacyCandidate] = useState<LegacySessionCandidate | null>(null);
  const [adminHouseholdView, setAdminHouseholdView] =
    useState<AdminHouseholdViewSelection | null>(null);
  const activeUserRef = useRef<User | null>(null);
  const resolutionGenerationRef = useRef(0);
  const sessionGenerationRef = useRef(0);
  const endpointRegistrationGenerationRef = useRef(0);

  const clearResolvedSession = useCallback(() => {
    resetClientOptimisticProjections();
    clearClientSessionScope();
    setHousehold(null);
    setHouseholdKey(null);
    setCurrentMember(null);
    setAdminHouseholdView(null);
  }, []);

  const restoreAdministratorHouseholdView = useCallback(async (
    user: User,
    selection: AdminHouseholdViewSelection,
  ) => {
    const resolutionGeneration = ++resolutionGenerationRef.current;
    setSessionState('resolving');
    setSessionError(null);
    clearResolvedSession();

    try {
      const token = await user.getIdTokenResult(true);
      if (token.claims.systemAdmin !== true) {
        throw new Error('서버에서 확인된 관리자 권한이 없습니다.');
      }
      const loadedHousehold = await withinDeadline(
        getHousehold(selection.householdId),
        HOUSEHOLD_READ_TIMEOUT_MS,
        'HOUSEHOLD_READ_TIMEOUT'
      );
      if (resolutionGeneration !== resolutionGenerationRef.current) return;

      setClientSessionScope({
        sessionGeneration: ++sessionGenerationRef.current,
        principalUid: user.uid,
        householdId: selection.householdId,
        memberId: 'system-administrator',
        accessMode: 'administrator-readonly',
      });
      setHousehold(loadedHousehold);
      setHouseholdKey(selection.householdId);
      setCurrentMember(null);
      setLegacyCandidate(null);
      setAdminHouseholdView({
        householdId: selection.householdId,
        householdName: loadedHousehold.name || selection.householdName,
      });
      setSessionState('ready');
    } catch (error) {
      if (resolutionGeneration !== resolutionGenerationRef.current) return;
      clearAdminHouseholdViewSelection();
      clearResolvedSession();
      setSessionError(errorMessage(error));
      setSessionState('error');
    }
  }, [clearResolvedSession]);

  const restoreSignedInUser = useCallback(async (
    user: User,
    candidate?: LegacySessionCandidate,
    prefetchedResolution?: SignedInUserResolution
  ) => {
    const resolutionGeneration = ++resolutionGenerationRef.current;
    setSessionState('resolving');
    setSessionError(null);
    clearResolvedSession();

    try {
      const resolution = prefetchedResolution ?? await withinDeadline(
        householdCommands.resolveSignedInUser(),
        SESSION_RESOLUTION_TIMEOUT_MS,
        'SESSION_RESOLUTION_TIMEOUT'
      );
      if (resolutionGeneration !== resolutionGenerationRef.current) return;

      if (resolution.kind === 'first-visit-required') {
        clearSignedInMembershipCache();
        if (candidate) {
          setLegacyCandidate(candidate);
          setSessionState('legacy-confirmation');
        } else {
          setLegacyCandidate(null);
          setSessionState('first-visit');
        }
        return;
      }

      const membership = resolution.membership;
      if (
        !membership.householdId ||
        !membership.memberId ||
        !membership.displayName ||
        !Number.isInteger(membership.aggregateVersion) ||
        membership.aggregateVersion < 1
      ) {
        throw new Error('서버가 완전한 본인 Membership을 반환하지 않았습니다.');
      }

      const resolvedSelf: HouseholdMember = {
        id: membership.memberId,
        name: membership.displayName,
        aggregateVersion: membership.aggregateVersion,
      };
      const sessionGeneration = ++sessionGenerationRef.current;

      setClientSessionScope({
        sessionGeneration,
        principalUid: user.uid,
        householdId: membership.householdId,
        memberId: membership.memberId,
        accessMode: 'member',
      });

      const applyHousehold = (loadedHousehold: Household) => {
        if (resolutionGeneration !== resolutionGenerationRef.current) return;
        const readModelSelf = loadedHousehold.members.find(
          (member) => member.id === resolvedSelf.id
        );
        const self = readModelSelf
          && readModelSelf.aggregateVersion >= resolvedSelf.aggregateVersion
          ? readModelSelf
          : resolvedSelf;
        const members = loadedHousehold.members.some((member) => member.id === self.id)
          ? loadedHousehold.members.map((member) => member.id === self.id ? self : member)
          : [...loadedHousehold.members, self];
        setHousehold({ ...loadedHousehold, members });
        setHouseholdKey(membership.householdId);
        setCurrentMember(self);
        setLegacyCandidate(null);
        clearLegacySessionCandidate();
        const normalizedHousehold = { ...loadedHousehold, members };
        writeSignedInMembershipCache(user.uid, {
          kind: 'membership-found',
          membership: {
            ...membership,
            displayName: self.name,
            aggregateVersion: self.aggregateVersion,
          },
        }, normalizedHousehold);
        setSessionState('ready');
        if (endpointRegistrationGenerationRef.current !== sessionGeneration) {
          endpointRegistrationGenerationRef.current = sessionGeneration;
          void import('@/platform/pwa/fidEndpointLifecycle')
            .then(({ activatePwaFidEndpoint }) => activatePwaFidEndpoint())
            .catch(() => {
              // 알림 endpoint 등록 실패는 로그인과 가계부 사용을 막지 않습니다.
              // 설정 화면에서 실제 서버 등록 상태와 재연결 동작을 제공합니다.
            });
        }
      };

      // localStorage bootstrap snapshot은 IndexedDB 초기화도 기다리지 않고 동기식으로
      // 화면을 엽니다. 실제 권한과 최신 값은 이어지는 Firestore read가 확정합니다.
      const fastHousehold = readSignedInHouseholdCache(user.uid, membership.householdId);
      if (fastHousehold) applyHousehold(fastHousehold);

      const cachedHousehold = fastHousehold
        ?? await getCachedHousehold(membership.householdId);
      if (!fastHousehold && cachedHousehold) applyHousehold(cachedHousehold);

      try {
        const loadedHousehold = await withinDeadline(
          getHousehold(membership.householdId),
          HOUSEHOLD_READ_TIMEOUT_MS,
          'HOUSEHOLD_READ_TIMEOUT'
        );
        applyHousehold(loadedHousehold);
      } catch (error) {
        // 검증된 membership과 캐시로 이미 화면을 복구했다면 일시적인 read
        // 장애 때문에 다시 전체 화면을 막지 않습니다.
        if (
          error instanceof HouseholdReadNotFoundError
          || !cachedHousehold
          || !isTransientHouseholdReadFailure(error)
        ) {
          throw error;
        }
      }
    } catch (error) {
      if (resolutionGeneration !== resolutionGenerationRef.current) return;
      clearSignedInMembershipCache();
      clearResolvedSession();
      setSessionError(errorMessage(error));
      setSessionState('error');
    }
  }, [clearResolvedSession]);

  useEffect(() => {
    let disposed = false;
    let androidBootstrapPending = isAndroidHostAvailable();
    let androidBootstrapStarted = false;
    let androidBootstrapFallbackId: number | undefined;
    let appliedAuthUid: string | null | undefined;
    let appliedResolutionKey: string | undefined;
    let restoredFromCache = false;

    const resolutionKey = (resolution?: SignedInUserResolution): string | undefined =>
      resolution?.kind === 'membership-found'
        ? `${resolution.membership.householdId}\u0000${resolution.membership.memberId}`
        : resolution?.kind;

    const applyUser = (
      user: User | null,
      prefetchedResolution?: SignedInUserResolution
    ) => {
      if (disposed) return;
      const nextUid = user?.uid ?? null;
      const nextResolutionKey = resolutionKey(prefetchedResolution);
      if (
        appliedAuthUid === nextUid
        && (nextResolutionKey === undefined || appliedResolutionKey === nextResolutionKey)
      ) return;
      appliedAuthUid = nextUid;
      appliedResolutionKey = nextResolutionKey;
      activeUserRef.current = user;
      if (!user) {
        resolutionGenerationRef.current += 1;
        clearResolvedSession();
        setLegacyCandidate(null);
        setSessionError(null);
        setSessionState('signed-out');
        return;
      }
      const adminSelection = readAdminHouseholdViewSelection();
      if (adminSelection !== null && !isAndroidHostAvailable()) {
        void restoreAdministratorHouseholdView(user, adminSelection);
        return;
      }
      void restoreSignedInUser(
        user,
        captureLegacySessionCandidate(),
        prefetchedResolution
      );
    };

    const startAndroidBootstrap = () => {
      if (disposed || !androidBootstrapPending || androidBootstrapStarted) return;
      androidBootstrapStarted = true;
      void withinDeadline(
        restoreAndroidHostAuth(),
        AUTH_BOOTSTRAP_TIMEOUT_MS,
        'ANDROID_AUTH_BOOTSTRAP_TIMEOUT'
      ).then((session) => {
        androidBootstrapPending = false;
        if (session?.signedInUserResolution?.kind === 'membership-found') {
          writeSignedInMembershipCache(
            session.user.uid,
            session.signedInUserResolution
          );
        } else if (session?.signedInUserResolution?.kind === 'first-visit-required') {
          clearSignedInMembershipCache();
        }
        applyUser(
          session?.user ?? null,
          session?.signedInUserResolution
        );
      }).catch((error) => {
        androidBootstrapPending = false;
        if (disposed) return;
        if (restoredFromCache) return;
        clearResolvedSession();
        setSessionError(errorMessage(error));
        setSessionState('error');
      });
    };

    const unsubscribe = onAuthChange((user) => {
      const cachedResolution = user
        ? readSignedInMembershipCache(user.uid)
        : undefined;
      if (androidBootstrapPending) {
        // 영속 Web Auth가 복원되면 매 실행마다 Native custom-token을 다시
        // 발급하지 않습니다. Firebase SDK의 token refresh와 서버 rules가 실제
        // read/write 권한을 계속 검증합니다.
        if (user && !androidBootstrapStarted) {
          androidBootstrapPending = false;
          restoredFromCache = cachedResolution !== undefined;
          applyUser(user, cachedResolution);
        } else if (!user) {
          startAndroidBootstrap();
        }
        return;
      }
      applyUser(user, cachedResolution);
    });

    if (androidBootstrapPending) {
      // Firebase auth observer는 persistence 복원 후 반드시 한 번 호출됩니다.
      // 비정상적으로 지연될 때만 Native 경로를 fallback으로 시작합니다.
      androidBootstrapFallbackId = window.setTimeout(startAndroidBootstrap, 500);
    }

    return () => {
      disposed = true;
      if (androidBootstrapFallbackId !== undefined) {
        window.clearTimeout(androidBootstrapFallbackId);
      }
      unsubscribe();
    };
  }, [clearResolvedSession, restoreAdministratorHouseholdView, restoreSignedInUser]);

  const signIn = useCallback(async () => {
    const candidate = captureLegacySessionCandidate();
    setLegacyCandidate(candidate ?? null);
    setSessionError(null);
    try {
      const session = activeUserRef.current
        ? { user: activeUserRef.current, signedInUserResolution: undefined }
        : await signInWithGoogleSession();
      const user = session?.user ?? null;
      if (!user) {
        setSessionError('Google 로그인을 완료하지 못했습니다.');
        setSessionState('signed-out');
        return;
      }
      activeUserRef.current = user;
      const adminSelection = readAdminHouseholdViewSelection();
      if (adminSelection !== null && !isAndroidHostAvailable()) {
        await restoreAdministratorHouseholdView(user, adminSelection);
      } else {
        await restoreSignedInUser(user, candidate, session?.signedInUserResolution);
      }
    } catch (error) {
      setSessionError(errorMessage(error));
      setSessionState('signed-out');
    }
  }, [restoreAdministratorHouseholdView, restoreSignedInUser]);

  const retrySession = useCallback(async () => {
    const user = activeUserRef.current;
    if (!user) {
      await signIn();
      return;
    }
    const adminSelection = readAdminHouseholdViewSelection();
    if (adminSelection !== null && !isAndroidHostAvailable()) {
      await restoreAdministratorHouseholdView(user, adminSelection);
      return;
    }
    await restoreSignedInUser(user, legacyCandidate ?? captureLegacySessionCandidate());
  }, [legacyCandidate, restoreAdministratorHouseholdView, restoreSignedInUser, signIn]);

  const confirmLegacyMembership = useCallback(async () => {
    const user = activeUserRef.current;
    if (!user || !legacyCandidate) throw new Error('연결할 기존 세션 후보가 없습니다.');
    setSessionState('resolving');
    setSessionError(null);
    try {
      await householdCommands.claimLegacyMembership(legacyCandidate);
      await restoreSignedInUser(user);
    } catch (error) {
      setSessionError(errorMessage(error));
      setSessionState('legacy-confirmation');
      throw error;
    }
  }, [legacyCandidate, restoreSignedInUser]);

  const createHouseholdForSelf = useCallback(async (
    householdName: string,
    memberName: string
  ) => {
    const user = activeUserRef.current;
    if (!user) throw new Error('Google 로그인이 필요합니다.');
    setSessionState('resolving');
    setSessionError(null);
    try {
      await householdCommands.createWithSelf(householdName.trim(), memberName.trim());
      await restoreSignedInUser(user);
    } catch (error) {
      setSessionError(errorMessage(error));
      setSessionState('first-visit');
      throw error;
    }
  }, [restoreSignedInUser]);

  const joinHouseholdAsSelf = useCallback(async (
    invitationCode: string,
    memberName: string
  ) => {
    const user = activeUserRef.current;
    if (!user) throw new Error('Google 로그인이 필요합니다.');
    setSessionState('resolving');
    setSessionError(null);
    try {
      await householdCommands.joinAsSelf(invitationCode.trim(), memberName.trim());
      await restoreSignedInUser(user);
    } catch (error) {
      setSessionError(errorMessage(error));
      setSessionState('first-visit');
      throw error;
    }
  }, [restoreSignedInUser]);

  const logout = useCallback(async () => {
    let logoutError: unknown;
    try {
      const { removePwaFidEndpointForLogout } = await import(
        '@/platform/pwa/fidEndpointLifecycle'
      );
      await removePwaFidEndpointForLogout();
    } catch {
      // 원격 endpoint 정리는 다음 로그인 binding 교체로 수렴시킵니다.
      // 편의 알림 정리 실패가 로컬 로그아웃을 막지 않습니다.
    }
    try {
      await logOut();
    } catch (error) {
      logoutError ??= error;
    } finally {
      resolutionGenerationRef.current += 1;
      activeUserRef.current = null;
      clearResolvedSession();
      clearLegacySessionCandidate();
      clearAdminHouseholdViewSelection();
      clearSignedInMembershipCache();
      setLegacyCandidate(null);
      setSessionError(null);
      setSessionState('signed-out');
      await clearPwaRuntimeCaches().catch(() => {});
    }
    if (logoutError) throw logoutError;
  }, [clearResolvedSession]);

  const renameMember = useCallback(async (memberId: string, name: string) => {
    const trimmedName = name.trim();
    if (!household || !currentMember || memberId !== currentMember.id) {
      throw new Error('본인의 이름만 변경할 수 있습니다.');
    }
    if (!trimmedName) throw new Error('이름을 입력해 주세요.');
    if (trimmedName === currentMember.name) return;

    await renameHouseholdMember(
      household.id,
      currentMember.id,
      trimmedName,
      currentMember.aggregateVersion
    );
    const updated = {
      ...currentMember,
      name: trimmedName,
      aggregateVersion: currentMember.aggregateVersion + 1,
    };
    setCurrentMember(updated);
    setHousehold({
      ...household,
      members: household.members.map((member) => member.id === updated.id ? updated : member),
    });
  }, [currentMember, household]);

  return (
    <HouseholdContext.Provider value={{
      household,
      householdKey,
      isLoading: sessionState === 'resolving',
      isAuthenticated: sessionState === 'ready',
      currentMember,
      sessionState,
      sessionError,
      legacyCandidate,
      adminHouseholdView,
      signIn,
      retrySession,
      confirmLegacyMembership,
      createHouseholdForSelf,
      joinHouseholdAsSelf,
      logout,
      renameMember,
    }}>
      {children}
    </HouseholdContext.Provider>
  );
}

export function useHousehold() {
  const context = useContext(HouseholdContext);
  if (!context) throw new Error('useHousehold must be used within a HouseholdProvider');
  return context;
}
