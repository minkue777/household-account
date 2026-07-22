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
import { getHousehold, renameHouseholdMember } from '@/lib/householdService';
import {
  logOut,
  onAuthChange,
  restoreAndroidHostAuth,
  signInWithGoogle,
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
import { removePwaFidEndpointForLogout } from '@/platform/pwa/fidEndpointLifecycle';
import { clearPwaRuntimeCaches } from '@/platform/pwa/sessionCache';
import { withinDeadline } from '@/platform/network/operationDeadline';
import { isAndroidHostAvailable } from '@/platform/android-host/androidHostBridge';

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
    clearClientSessionScope();
    setHousehold(null);
    setHouseholdKey(null);
    setCurrentMember(null);
  }, []);

  const restoreSignedInUser = useCallback(async (
    user: User,
    candidate?: LegacySessionCandidate
  ) => {
    const resolutionGeneration = ++resolutionGenerationRef.current;
    setSessionState('resolving');
    setSessionError(null);
    clearResolvedSession();

    try {
      const resolution = await withinDeadline(
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

      const loadedHousehold = await withinDeadline(
        getHousehold(membership.householdId),
        HOUSEHOLD_READ_TIMEOUT_MS,
        'HOUSEHOLD_READ_TIMEOUT'
      );
      if (!loadedHousehold) throw new Error('연결된 가계부 Read Model을 찾을 수 없습니다.');
      if (resolutionGeneration !== resolutionGenerationRef.current) return;

      const self: HouseholdMember = {
        id: membership.memberId,
        name: membership.displayName,
        aggregateVersion: membership.aggregateVersion,
      };
      const members = loadedHousehold.members.some((member) => member.id === self.id)
        ? loadedHousehold.members.map((member) => member.id === self.id ? self : member)
        : [...loadedHousehold.members, self];
      const nextHousehold = { ...loadedHousehold, members };
      const sessionGeneration = ++sessionGenerationRef.current;

      setClientSessionScope({
        sessionGeneration,
        principalUid: user.uid,
        householdId: membership.householdId,
        memberId: membership.memberId,
      });
      setHousehold(nextHousehold);
      setHouseholdKey(membership.householdId);
      setCurrentMember(self);
      setLegacyCandidate(null);
      clearLegacySessionCandidate();
      setSessionState('ready');
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
    let restoredUserHandled = false;

    const applyUser = (user: User | null) => {
      if (disposed) return;
      activeUserRef.current = user;
      if (!user) {
        resolutionGenerationRef.current += 1;
        clearResolvedSession();
        setLegacyCandidate(null);
        setSessionError(null);
        setSessionState('signed-out');
        return;
      }
      restoredUserHandled = true;
      void restoreSignedInUser(user, captureLegacySessionCandidate());
    };

    const unsubscribe = onAuthChange((user) => {
      // Android는 native Firebase 세션이 권위입니다. WebView의 빈/오래된
      // persistence callback보다 native custom-token 교환을 먼저 완료합니다.
      if (androidBootstrapPending && !user) return;
      applyUser(user);
    });

    if (androidBootstrapPending) {
      void withinDeadline(
        restoreAndroidHostAuth(),
        AUTH_BOOTSTRAP_TIMEOUT_MS,
        'ANDROID_AUTH_BOOTSTRAP_TIMEOUT'
      ).then((user) => {
        androidBootstrapPending = false;
        if (!restoredUserHandled) applyUser(user);
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
      const user = activeUserRef.current ?? await signInWithGoogle();
      if (!user) {
        setSessionError('Google 로그인을 완료하지 못했습니다.');
        setSessionState('signed-out');
        return;
      }
      activeUserRef.current = user;
      await restoreSignedInUser(user, candidate);
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
    await removePwaFidEndpointForLogout();
    await logOut();
    resolutionGenerationRef.current += 1;
    activeUserRef.current = null;
    clearResolvedSession();
    clearLegacySessionCandidate();
    setLegacyCandidate(null);
    setSessionState('signed-out');
    await clearPwaRuntimeCaches().catch(() => {});
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
