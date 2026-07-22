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
  clearClientSessionScope,
  setClientSessionScope,
} from '@/composition/clientSessionScope';
import { resetClientOptimisticProjections } from '@/composition/resetClientOptimisticProjections';
import { removePwaFidEndpointForLogout } from '@/platform/pwa/fidEndpointLifecycle';
import { clearPwaRuntimeCaches } from '@/platform/pwa/sessionCache';
import {
  OperationDeadlineExceededError,
  withinDeadline,
} from '@/platform/network/operationDeadline';
import {
  isAndroidHostAvailable,
  type AndroidSignedInUserResolution,
} from '@/platform/android-host/androidHostBridge';

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
  const activeUserRef = useRef<User | null>(null);
  const resolutionGenerationRef = useRef(0);
  const sessionGenerationRef = useRef(0);

  const clearResolvedSession = useCallback(() => {
    resetClientOptimisticProjections();
    clearClientSessionScope();
    setHousehold(null);
    setHouseholdKey(null);
    setCurrentMember(null);
  }, []);

  const restoreSignedInUser = useCallback(async (
    user: User,
    candidate?: LegacySessionCandidate,
    prefetchedResolution?: AndroidSignedInUserResolution
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

      const self: HouseholdMember = {
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
      });

      const applyHousehold = (loadedHousehold: Household) => {
        if (resolutionGeneration !== resolutionGenerationRef.current) return;
        const members = loadedHousehold.members.some((member) => member.id === self.id)
          ? loadedHousehold.members.map((member) => member.id === self.id ? self : member)
          : [...loadedHousehold.members, self];
        setHousehold({ ...loadedHousehold, members });
        setHouseholdKey(membership.householdId);
        setCurrentMember(self);
        setLegacyCandidate(null);
        clearLegacySessionCandidate();
        setSessionState('ready');
      };

      const cachedHousehold = await getCachedHousehold(membership.householdId);
      if (cachedHousehold) applyHousehold(cachedHousehold);

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
      clearResolvedSession();
      setSessionError(errorMessage(error));
      setSessionState('error');
    }
  }, [clearResolvedSession]);

  useEffect(() => {
    let disposed = false;
    let androidBootstrapPending = isAndroidHostAvailable();
    let appliedAuthUid: string | null | undefined;

    const applyUser = (
      user: User | null,
      prefetchedResolution?: AndroidSignedInUserResolution
    ) => {
      if (disposed) return;
      const nextUid = user?.uid ?? null;
      if (appliedAuthUid === nextUid) return;
      appliedAuthUid = nextUid;
      activeUserRef.current = user;
      if (!user) {
        resolutionGenerationRef.current += 1;
        clearResolvedSession();
        setLegacyCandidate(null);
        setSessionError(null);
        setSessionState('signed-out');
        return;
      }
      void restoreSignedInUser(
        user,
        captureLegacySessionCandidate(),
        prefetchedResolution
      );
    };

    const unsubscribe = onAuthChange((user) => {
      // Android는 native Firebase 세션이 권위입니다. WebView의 빈/오래된
      // persistence callback보다 native custom-token 교환을 먼저 완료합니다.
      if (androidBootstrapPending) return;
      applyUser(user);
    });

    if (androidBootstrapPending) {
      void withinDeadline(
        restoreAndroidHostAuth(),
        AUTH_BOOTSTRAP_TIMEOUT_MS,
        'ANDROID_AUTH_BOOTSTRAP_TIMEOUT'
      ).then((session) => {
        androidBootstrapPending = false;
        applyUser(
          session?.user ?? null,
          session?.signedInUserResolution
        );
      }).catch((error) => {
        androidBootstrapPending = false;
        if (disposed) return;
        clearResolvedSession();
        setSessionError(errorMessage(error));
        setSessionState('error');
      });
    }

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [clearResolvedSession, restoreSignedInUser]);

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
      await restoreSignedInUser(user, candidate, session?.signedInUserResolution);
    } catch (error) {
      setSessionError(errorMessage(error));
      setSessionState('signed-out');
    }
  }, [restoreSignedInUser]);

  const retrySession = useCallback(async () => {
    const user = activeUserRef.current;
    if (!user) {
      await signIn();
      return;
    }
    await restoreSignedInUser(user, legacyCandidate ?? captureLegacySessionCandidate());
  }, [legacyCandidate, restoreSignedInUser, signIn]);

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
