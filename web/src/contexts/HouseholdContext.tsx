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
  DEFAULT_HOME_SUMMARY_CONFIG,
  type HomeSummaryCardKey,
  type Household,
  type HouseholdMember,
} from '@/types/household';
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
import { Platform } from '@/lib/utils/platform';
import {
  clearSignedInMembershipCache,
  readSignedInMembershipCache,
  writeSignedInMembershipCache,
  type SignedInUserResolution,
} from '@/features/access-household/application/signedInMembershipCache';
import {
  cancelQueuedAuthoritativeMembershipResolution,
  MEMBERSHIP_RESOLUTION_REQUESTED_EVENT,
  requestAuthoritativeMembershipResolution,
} from '@/features/access-household/application/membershipResolutionRecovery';
import {
  markWebAuthCompleted,
  markWebAuthStarted,
  markWebBootstrapStarted,
  markWebHouseholdCompleted,
  markWebHouseholdStarted,
  markWebMembershipCacheUsed,
  markWebMembershipCompleted,
  markWebMembershipPrefetched,
  markWebMembershipStarted,
  scheduleAfterWebFirstLedgerPaint,
} from '@/platform/performance/webStartupPerformance';
import { REMOTE_SESSION_RECOVERED_EVENT } from '@/platform/functions-api/firebaseCallableRecovery';
import { isFirebaseEmulatorTestLoginEnabled } from '@/platform/firebase/firebaseEmulatorConfig';

const INTERACTIVE_AUTH_BOOTSTRAP_TIMEOUT_MS = 180_000;
const SESSION_RESOLUTION_TIMEOUT_MS = 20_000;
const HOUSEHOLD_READ_TIMEOUT_MS = 20_000;
const PWA_ENDPOINT_REGISTRATION_FALLBACK_MS = 15_000;
const MEMBERSHIP_RECOVERY_RETRY_BASE_MS = 2_000;
const MEMBERSHIP_RECOVERY_RETRY_MAX_MS = 30_000;

type AuthServiceModule = typeof import('@/lib/authService');

let authServiceModulePromise: Promise<AuthServiceModule> | undefined;

function loadAuthService(): Promise<AuthServiceModule> {
  if (authServiceModulePromise === undefined) {
    const loading = import('@/lib/authService').catch((error) => {
      authServiceModulePromise = undefined;
      throw error;
    });
    authServiceModulePromise = loading;
  }
  return authServiceModulePromise;
}

markWebBootstrapStarted();

export type HouseholdSessionState =
  | 'resolving'
  | 'signed-out'
  | 'legacy-confirmation'
  | 'first-visit'
  | 'ready'
  | 'error';

export type RemoteSessionStatus = 'connecting' | 'ready' | 'degraded';
type RestoreSignedInUserOutcome = 'preserved-transient-failure' | undefined;

interface HouseholdContextType {
  household: Household | null;
  householdKey: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isSessionVerified: boolean;
  remoteSessionStatus: RemoteSessionStatus;
  remoteReadEpoch: number;
  currentMember: HouseholdMember | null;
  sessionState: HouseholdSessionState;
  sessionError: string | null;
  legacyCandidate: LegacySessionCandidate | null;
  adminHouseholdView: AdminHouseholdViewSelection | null;
  signIn: () => Promise<void>;
  retrySession: () => Promise<void>;
  recoverRemoteSession: () => Promise<void>;
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
  'functions/cancelled',
  'functions/deadline-exceeded',
  'functions/internal',
  'functions/unavailable',
]);

function isTransientHouseholdReadFailure(error: unknown): boolean {
  if (error instanceof OperationDeadlineExceededError) return true;
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return TRANSIENT_FIRESTORE_READ_CODES.has(String((error as { code: unknown }).code));
}

const HOME_SUMMARY_CARD_KEYS = new Set<HomeSummaryCardKey>([
  'localCurrencyBalance',
  'monthlyRemainingBudget',
  'monthlySpent',
  'yearlySpent',
]);

function householdFromResolution(
  resolution: Extract<SignedInUserResolution, { kind: 'membership-found' }>
): Household | undefined {
  const value = resolution.household;
  if (
    !value
    || value.id !== resolution.membership.householdId
    || value.name.trim() === ''
    || Number.isNaN(Date.parse(value.createdAt))
    || value.members.some(
      (member) =>
        member.id.trim() === ''
        || member.name.trim() === ''
        || !Number.isInteger(member.aggregateVersion)
        || member.aggregateVersion < 1
    )
  ) {
    return undefined;
  }
  const summary = value.homeSummaryConfig;
  return {
    id: value.id,
    name: value.name,
    createdAt: new Date(value.createdAt),
    ...(value.defaultCategoryKey === undefined
      ? {}
      : { defaultCategoryKey: value.defaultCategoryKey }),
    homeSummaryConfig:
      summary
      && HOME_SUMMARY_CARD_KEYS.has(summary.leftCard as HomeSummaryCardKey)
      && HOME_SUMMARY_CARD_KEYS.has(summary.rightCard as HomeSummaryCardKey)
        ? {
            leftCard: summary.leftCard as HomeSummaryCardKey,
            rightCard: summary.rightCard as HomeSummaryCardKey,
          }
        : DEFAULT_HOME_SUMMARY_CONFIG,
    members: value.members.map((member) => ({ ...member })),
  };
}

function householdToResolutionView(
  household: Household
): NonNullable<
  Extract<SignedInUserResolution, { kind: 'membership-found' }>['household']
> {
  return {
    id: household.id,
    name: household.name,
    createdAt: household.createdAt.toISOString(),
    ...(household.defaultCategoryKey === undefined
      ? {}
      : { defaultCategoryKey: household.defaultCategoryKey }),
    ...(household.homeSummaryConfig === undefined
      ? {}
      : { homeSummaryConfig: household.homeSummaryConfig }),
    members: household.members.map((member) => ({ ...member })),
  };
}

function sameHousehold(left: Household | null, right: Household): boolean {
  if (
    left === null
    || left.id !== right.id
    || left.name !== right.name
    || left.createdAt.getTime() !== right.createdAt.getTime()
    || left.defaultCategoryKey !== right.defaultCategoryKey
    || left.homeSummaryConfig?.leftCard !== right.homeSummaryConfig?.leftCard
    || left.homeSummaryConfig?.rightCard !== right.homeSummaryConfig?.rightCard
    || left.members.length !== right.members.length
  ) {
    return false;
  }

  return left.members.every((member, index) => {
    const nextMember = right.members[index];
    return member.id === nextMember.id
      && member.name === nextMember.name
      && member.aggregateVersion === nextMember.aggregateVersion;
  });
}

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const [household, setHousehold] = useState<Household | null>(null);
  const [householdKey, setHouseholdKey] = useState<string | null>(null);
  const [currentMember, setCurrentMember] = useState<HouseholdMember | null>(null);
  const [sessionState, setSessionState] = useState<HouseholdSessionState>('resolving');
  const [isSessionVerified, setIsSessionVerified] = useState(false);
  const [remoteSessionStatus, setRemoteSessionStatus] =
    useState<RemoteSessionStatus>('connecting');
  const [remoteReadEpoch, setRemoteReadEpoch] = useState(0);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [legacyCandidate, setLegacyCandidate] = useState<LegacySessionCandidate | null>(null);
  const [adminHouseholdView, setAdminHouseholdView] =
    useState<AdminHouseholdViewSelection | null>(null);
  const activeUserRef = useRef<User | null>(null);
  const householdRef = useRef<Household | null>(null);
  const currentMemberRef = useRef<HouseholdMember | null>(null);
  const resolutionGenerationRef = useRef(0);
  const sessionGenerationRef = useRef(0);
  const endpointRegistrationGenerationRef = useRef(0);
  const cancelEndpointRegistrationRef = useRef<(() => void) | undefined>();

  const activateRemoteSession = useCallback(() => {
    setIsSessionVerified(true);
    setRemoteSessionStatus('ready');
    setSessionError(null);
    // Token 복구 뒤 이미 error callback으로 종료된 Firestore listener도 새로 엽니다.
    setRemoteReadEpoch((current) => current + 1);
  }, []);

  useEffect(() => {
    const handleRecoveredSession = () => activateRemoteSession();
    window.addEventListener(
      REMOTE_SESSION_RECOVERED_EVENT,
      handleRecoveredSession
    );
    return () => {
      window.removeEventListener(
        REMOTE_SESSION_RECOVERED_EVENT,
        handleRecoveredSession
      );
    };
  }, [activateRemoteSession]);

  const clearResolvedSession = useCallback(() => {
    cancelEndpointRegistrationRef.current?.();
    cancelEndpointRegistrationRef.current = undefined;
    resetClientOptimisticProjections();
    clearClientSessionScope();
    householdRef.current = null;
    currentMemberRef.current = null;
    setHousehold(null);
    setHouseholdKey(null);
    setCurrentMember(null);
    setAdminHouseholdView(null);
    setIsSessionVerified(false);
    setRemoteSessionStatus('connecting');
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
      const { getHousehold } = await import('@/lib/householdService');
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
      activateRemoteSession();
      householdRef.current = loadedHousehold;
      currentMemberRef.current = null;
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
  }, [activateRemoteSession, clearResolvedSession]);

  const restoreSignedInUser = useCallback(async (
    user: User,
    candidate?: LegacySessionCandidate,
    prefetchedResolution?: SignedInUserResolution,
    options: {
      preserveResolvedSession?: boolean;
      membershipSource?: 'last-verified-cache' | 'authoritative-prefetch';
    } = {}
  ): Promise<RestoreSignedInUserOutcome> => {
    const resolutionGeneration = ++resolutionGenerationRef.current;
    setSessionError(null);
    if (!options.preserveResolvedSession) {
      setSessionState('resolving');
      clearResolvedSession();
    }

    try {
      let resolution: SignedInUserResolution;
      if (prefetchedResolution !== undefined) {
        resolution = prefetchedResolution;
        if (options.membershipSource === 'last-verified-cache') {
          markWebMembershipCacheUsed();
        } else {
          markWebMembershipPrefetched();
        }
      } else {
        markWebMembershipStarted();
        try {
          const { householdCommands } = await import(
            '@/features/access-household/application/householdCommands'
          );
          resolution = await withinDeadline(
            householdCommands.resolveSignedInUser(),
            SESSION_RESOLUTION_TIMEOUT_MS,
            'SESSION_RESOLUTION_TIMEOUT'
          );
          markWebMembershipCompleted(true);
        } catch (error) {
          markWebMembershipCompleted(false);
          throw error;
        }
      }
      if (resolutionGeneration !== resolutionGenerationRef.current) return;

      if (resolution.kind === 'first-visit-required') {
        clearSignedInMembershipCache();
        clearResolvedSession();
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
      setHouseholdKey(membership.householdId);
      currentMemberRef.current = resolvedSelf;
      setCurrentMember(resolvedSelf);
      activateRemoteSession();

      const applyHousehold = (
        loadedHousehold: Household,
        persist = true,
        forcePersist = false
      ) => {
        if (resolutionGeneration !== resolutionGenerationRef.current) return;
        const readModelSelf = loadedHousehold.members.find(
          (member) => member.id === resolvedSelf.id
        );
        const currentSelf =
          currentMemberRef.current?.id === resolvedSelf.id
            ? currentMemberRef.current
            : undefined;
        const self = [resolvedSelf, readModelSelf, currentSelf]
          .filter((member): member is HouseholdMember => member !== undefined)
          .reduce((latest, member) =>
            member.aggregateVersion >= latest.aggregateVersion ? member : latest
          );
        const currentHousehold =
          householdRef.current?.id === loadedHousehold.id
            ? householdRef.current
            : null;
        const currentMembersById = new Map(
          currentHousehold?.members.map((member) => [member.id, member]) ?? []
        );
        const members = loadedHousehold.members.map((member) => {
          const current = currentMembersById.get(member.id);
          if (member.id === self.id) return self;
          return current && current.aggregateVersion > member.aggregateVersion
            ? current
            : member;
        });
        if (!members.some((member) => member.id === self.id)) {
          members.push(self);
        }
        const nextHousehold = { ...loadedHousehold, members };
        const householdChanged = !sameHousehold(householdRef.current, nextHousehold);
        if (householdChanged) {
          householdRef.current = nextHousehold;
          setHousehold(nextHousehold);
        }
        setHouseholdKey(membership.householdId);
        currentMemberRef.current = self;
        setCurrentMember((current) =>
          current?.id === self.id
          && current.name === self.name
          && current.aggregateVersion === self.aggregateVersion
            ? current
            : self
        );
        setLegacyCandidate(null);
        clearLegacySessionCandidate();
        if (persist && (householdChanged || forcePersist)) {
          writeSignedInMembershipCache(user.uid, {
            kind: 'membership-found',
            membership: {
              ...membership,
              displayName: self.name,
              aggregateVersion: self.aggregateVersion,
            },
            household: householdToResolutionView(nextHousehold),
          });
        }
        setSessionState('ready');
        if (
          Platform.isIOSPWA()
          && endpointRegistrationGenerationRef.current !== sessionGeneration
        ) {
          endpointRegistrationGenerationRef.current = sessionGeneration;
          cancelEndpointRegistrationRef.current?.();
          cancelEndpointRegistrationRef.current = scheduleAfterWebFirstLedgerPaint(
            () => {
              cancelEndpointRegistrationRef.current = undefined;
              if (
                resolutionGeneration !== resolutionGenerationRef.current
                || activeUserRef.current?.uid !== user.uid
              ) {
                return;
              }
              void import('@/platform/pwa/fidEndpointLifecycle')
                .then(({ activatePwaFidEndpoint }) => activatePwaFidEndpoint())
                .catch(() => {
                  // 알림 endpoint 등록 실패는 로그인과 가계부 사용을 막지 않습니다.
                  // 설정 화면에서 실제 서버 등록 상태와 재연결 동작을 제공합니다.
                });
            },
            {
              fallbackMs: PWA_ENDPOINT_REGISTRATION_FALLBACK_MS,
              idleTimeoutMs: 5_000,
            }
          );
        }
      };

      const resolvedHousehold = householdFromResolution(resolution);
      const restoredFromCache =
        options.membershipSource === 'last-verified-cache';
      if (!restoredFromCache && resolvedHousehold === undefined) {
        // 구형/축약 응답도 scope는 보존하고 표시 metadata는 아래 서버 read로 보강합니다.
        writeSignedInMembershipCache(user.uid, resolution);
      }
      const initialHousehold = resolvedHousehold ?? {
        id: membership.householdId,
        name: '우리집',
        createdAt: new Date(0),
        homeSummaryConfig: DEFAULT_HOME_SUMMARY_CONFIG,
        members: [resolvedSelf],
      };
      const keepResolvedScreenWhileRefreshing =
        options.preserveResolvedSession
        && resolvedHousehold === undefined
        && householdRef.current?.id === membership.householdId;
      if (!keepResolvedScreenWhileRefreshing) {
        applyHousehold(
          initialHousehold,
          !restoredFromCache && resolvedHousehold !== undefined,
          !restoredFromCache && resolvedHousehold !== undefined
        );
      }

      const needsBackgroundHouseholdRefresh =
        options.membershipSource === 'last-verified-cache'
        || resolvedHousehold === undefined;
      if (!needsBackgroundHouseholdRefresh) return;

      // 저장된 scope로 원장 읽기를 즉시 시작하고, 표시용 가구 메타데이터만 병렬 갱신합니다.
      void import('@/lib/householdService')
        .then(({ getHousehold }) => {
          if (resolutionGeneration !== resolutionGenerationRef.current) return;
          markWebHouseholdStarted();
          return withinDeadline(
            getHousehold(membership.householdId),
            HOUSEHOLD_READ_TIMEOUT_MS,
            'HOUSEHOLD_READ_TIMEOUT'
          );
        })
        .then((loadedHousehold) => {
          if (!loadedHousehold) return;
          markWebHouseholdCompleted(true);
          applyHousehold(loadedHousehold);
        })
        .catch((error) => {
          if (resolutionGeneration !== resolutionGenerationRef.current) return;
          markWebHouseholdCompleted(false);
          if (isTransientHouseholdReadFailure(error)) return;
          clearSignedInMembershipCache();
          requestAuthoritativeMembershipResolution();
        });
    } catch (error) {
      if (resolutionGeneration !== resolutionGenerationRef.current) return;
      if (
        options.preserveResolvedSession
        && isTransientHouseholdReadFailure(error)
      ) {
        // 권한 오류 뒤 재해석이 일시적으로 실패해도 현재 화면은 유지합니다.
        // 실제 가구 접근 권한은 계속 Firestore rules와 Functions에서 검증합니다.
        setSessionState('ready');
        return 'preserved-transient-failure';
      }
      if (!isTransientHouseholdReadFailure(error)) {
        clearSignedInMembershipCache();
      }
      clearResolvedSession();
      setSessionError(errorMessage(error));
      setSessionState('error');
    }
  }, [activateRemoteSession, clearResolvedSession]);

  useEffect(() => {
    let disposed = false;
    let unsubscribeAuth: (() => void) | undefined;
    let androidBootstrapPending = isAndroidHostAvailable();
    let androidBootstrapStarted = false;
    let appliedAuthUid: string | null | undefined;
    let appliedResolutionKey: string | undefined;
    let membershipResolutionUidInFlight: string | null = null;
    let membershipResolutionRetryId: number | undefined;
    let membershipResolutionRetryAttempt = 0;
    let membershipResolutionRetryUid: string | null = null;
    let authObserverStartRequested = false;

    const cancelMembershipResolutionRetry = () => {
      if (membershipResolutionRetryId !== undefined) {
        window.clearTimeout(membershipResolutionRetryId);
        membershipResolutionRetryId = undefined;
      }
      membershipResolutionRetryAttempt = 0;
      membershipResolutionRetryUid = null;
    };

    const resolutionKey = (resolution?: SignedInUserResolution): string | undefined =>
      resolution?.kind === 'membership-found'
        ? `${resolution.membership.householdId}\u0000${resolution.membership.memberId}`
        : resolution?.kind;

    const applyUser = (
      user: User | null,
      prefetchedResolution?: SignedInUserResolution,
      preserveResolvedSession = false,
      membershipSource?: 'last-verified-cache' | 'authoritative-prefetch',
      activateWhenAlreadyApplied = true
    ) => {
      if (disposed) return;
      const nextUid = user?.uid ?? null;
      const nextResolutionKey = resolutionKey(prefetchedResolution);
      if (appliedAuthUid !== nextUid) {
        cancelMembershipResolutionRetry();
        cancelQueuedAuthoritativeMembershipResolution();
      }
      if (
        appliedAuthUid === nextUid
        && (nextResolutionKey === undefined || appliedResolutionKey === nextResolutionKey)
      ) {
        // 같은 UID의 ID token 갱신도 원격 연결 복구 신호입니다. 인증 오류로
        // 종료된 listener가 다시 구독할 수 있도록 epoch를 반드시 전진시킵니다.
        if (user && activateWhenAlreadyApplied) activateRemoteSession();
        return;
      }
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
        prefetchedResolution,
        { preserveResolvedSession, membershipSource }
      );
    };

    const scheduleMembershipResolutionRetry = (principalUid: string) => {
      if (
        disposed
        || activeUserRef.current?.uid !== principalUid
        || membershipResolutionRetryId !== undefined
      ) {
        return;
      }
      membershipResolutionRetryUid = principalUid;
      const delay = Math.min(
        MEMBERSHIP_RECOVERY_RETRY_MAX_MS,
        MEMBERSHIP_RECOVERY_RETRY_BASE_MS
          * (2 ** Math.min(membershipResolutionRetryAttempt, 4))
      );
      membershipResolutionRetryAttempt += 1;
      membershipResolutionRetryId = window.setTimeout(() => {
        membershipResolutionRetryId = undefined;
        if (
          disposed
          || membershipResolutionRetryUid !== principalUid
          || activeUserRef.current?.uid !== principalUid
        ) {
          return;
        }
        handleMembershipResolutionRequest();
      }, delay);
    };

    const handleMembershipResolutionRequest = () => {
      const user = activeUserRef.current;
      if (
        disposed
        || !user
        || membershipResolutionUidInFlight === user.uid
      ) {
        return;
      }
      if (readAdminHouseholdViewSelection() !== null && !isAndroidHostAvailable()) return;

      if (membershipResolutionRetryUid === user.uid) {
        if (membershipResolutionRetryId !== undefined) {
          window.clearTimeout(membershipResolutionRetryId);
          membershipResolutionRetryId = undefined;
        }
      } else {
        membershipResolutionRetryAttempt = 0;
      }
      membershipResolutionRetryUid = user.uid;
      membershipResolutionUidInFlight = user.uid;
      cancelQueuedAuthoritativeMembershipResolution();
      clearSignedInMembershipCache();
      void restoreSignedInUser(
        user,
        captureLegacySessionCandidate(),
        undefined,
        { preserveResolvedSession: true }
      ).then((outcome) => {
        if (disposed || activeUserRef.current?.uid !== user.uid) return;
        cancelQueuedAuthoritativeMembershipResolution();
        if (outcome === 'preserved-transient-failure') {
          scheduleMembershipResolutionRetry(user.uid);
          return;
        }
        cancelMembershipResolutionRetry();
      }).finally(() => {
        if (membershipResolutionUidInFlight === user.uid) {
          membershipResolutionUidInFlight = null;
        }
      });
    };

    const startAndroidBootstrap = () => {
      if (disposed || !androidBootstrapPending || androidBootstrapStarted) return;
      androidBootstrapStarted = true;
      void loadAuthService().then(({ restoreAndroidHostAuth }) => withinDeadline(
        restoreAndroidHostAuth(),
        INTERACTIVE_AUTH_BOOTSTRAP_TIMEOUT_MS,
        'ANDROID_AUTH_BOOTSTRAP_TIMEOUT'
      )).then((session) => {
        if (disposed || !androidBootstrapPending) return;
        androidBootstrapPending = false;
        markWebAuthCompleted(true);
        const resolvedMembership = session?.signedInUserResolution;
        if (session?.user && resolvedMembership?.kind === 'membership-found') {
          writeSignedInMembershipCache(
            session.user.uid,
            resolvedMembership
          );
        } else if (resolvedMembership?.kind === 'first-visit-required') {
          clearSignedInMembershipCache();
        }
        applyUser(
          session?.user ?? null,
          resolvedMembership,
          false,
          resolvedMembership === undefined ? undefined : 'authoritative-prefetch',
          false
        );
      }).catch((error) => {
        if (disposed || !androidBootstrapPending) return;
        markWebAuthCompleted(false);
        androidBootstrapPending = false;
        clearResolvedSession();
        setSessionError(errorMessage(error));
        setSessionState('error');
      });
    };

    const handleAuthChange = (user: User | null) => {
      const cachedResolution = user
        ? readSignedInMembershipCache(user.uid)
        : undefined;
      if (user || !androidBootstrapPending) {
        markWebAuthCompleted(true);
      }
      if (androidBootstrapPending) {
        if (user) {
          // Native custom-token 교환 중 signInWithCustomToken이 observer를 먼저
          // 깨울 수 있습니다. 이때 별도 Membership Command를 시작하면 곧 도착할
          // Native의 authoritative resolution과 같은 원격 조회를 중복합니다.
          if (androidBootstrapStarted) return;
          androidBootstrapPending = false;
          const immediatelyUsableResolution = cachedResolution;
          applyUser(
            user,
            immediatelyUsableResolution,
            false,
            immediatelyUsableResolution === undefined
              ? undefined
              : 'last-verified-cache'
          );
        } else {
          startAndroidBootstrap();
        }
        return;
      }
      applyUser(
        user,
        cachedResolution,
        false,
        cachedResolution ? 'last-verified-cache' : undefined
      );
    };

    const startAuthObserver = () => {
      if (disposed || authObserverStartRequested) return;
      authObserverStartRequested = true;
      markWebAuthStarted();

      // 인증 모듈을 별도 청크로 불러오고 즉시 Auth observer와 Android
      // native custom-token 복구를 시작합니다.
      void loadAuthService().then(({ onAuthChange }) => {
        if (disposed) return;
        unsubscribeAuth = onAuthChange(handleAuthChange);
        setRemoteSessionStatus((current) =>
          current === 'degraded' ? 'connecting' : current
        );

        // 첫 observer 결과로 영속 Web Auth 여부를 확인한 뒤에만 Native fallback을 시작합니다.
      })
      .catch((error) => {
        if (disposed) return;
        markWebAuthCompleted(false);
        clearResolvedSession();
        setSessionError(errorMessage(error));
        setSessionState('error');
      });
    };
    startAuthObserver();
    window.addEventListener(
      MEMBERSHIP_RESOLUTION_REQUESTED_EVENT,
      handleMembershipResolutionRequest
    );

    return () => {
      disposed = true;
      cancelMembershipResolutionRetry();
      cancelQueuedAuthoritativeMembershipResolution();
      unsubscribeAuth?.();
      window.removeEventListener(
        MEMBERSHIP_RESOLUTION_REQUESTED_EVENT,
        handleMembershipResolutionRequest
      );
    };
  }, [
    activateRemoteSession,
    clearResolvedSession,
    restoreAdministratorHouseholdView,
    restoreSignedInUser,
  ]);

  const signIn = useCallback(async () => {
    const candidate = captureLegacySessionCandidate();
    setLegacyCandidate(candidate ?? null);
    setSessionError(null);
    try {
      const {
        signInWithEmulatorTestSession,
        signInWithGoogleSession,
      } = await loadAuthService();
      const session = activeUserRef.current
        ? { user: activeUserRef.current, signedInUserResolution: undefined }
        : isFirebaseEmulatorTestLoginEnabled()
          ? await signInWithEmulatorTestSession()
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

  const recoverRemoteSession = useCallback(async () => {
    setRemoteSessionStatus('connecting');
    try {
      const {
        getCurrentUser,
        refreshAndroidWebAuth,
        restoreAndroidHostAuth,
      } = await loadAuthService();
      const currentUser = getCurrentUser();
      const session = currentUser
        ? await refreshAndroidWebAuth(currentUser)
        : await restoreAndroidHostAuth();
      if (!session?.user) throw new Error('ANDROID_AUTH_RESTORE_REQUIRED');

      const user = session.user;
      const preserveResolvedSession =
        activeUserRef.current?.uid === user.uid && householdKey !== null;
      activeUserRef.current = user;
      const cachedResolution =
        session.signedInUserResolution
        ?? readSignedInMembershipCache(user.uid);
      await restoreSignedInUser(
        user,
        captureLegacySessionCandidate(),
        cachedResolution,
        {
          preserveResolvedSession,
          membershipSource:
            cachedResolution === undefined
              ? undefined
              : session.signedInUserResolution === undefined
                ? 'last-verified-cache'
                : 'authoritative-prefetch',
        }
      );
    } catch (error) {
      setRemoteSessionStatus('degraded');
      setSessionError(errorMessage(error));
      throw error;
    }
  }, [householdKey, restoreSignedInUser]);

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
      const { householdCommands } = await import(
        '@/features/access-household/application/householdCommands'
      );
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
      const { householdCommands } = await import(
        '@/features/access-household/application/householdCommands'
      );
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
      const { householdCommands } = await import(
        '@/features/access-household/application/householdCommands'
      );
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
    if (Platform.isIOSPWA()) {
      try {
        const { removePwaFidEndpointForLogout } = await import(
          '@/platform/pwa/fidEndpointLifecycle'
        );
        await removePwaFidEndpointForLogout();
      } catch {
        // 원격 endpoint 정리는 다음 로그인 binding 교체로 수렴시킵니다.
        // 편의 알림 정리 실패가 로컬 로그아웃을 막지 않습니다.
      }
    }
    try {
      const { logOut } = await loadAuthService();
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

    const { renameHouseholdMember } = await import('@/lib/householdService');
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
    currentMemberRef.current = updated;
    setCurrentMember(updated);
    const updatedHousehold = {
      ...household,
      members: household.members.map((member) => member.id === updated.id ? updated : member),
    };
    householdRef.current = updatedHousehold;
    setHousehold(updatedHousehold);

    const principalUid = activeUserRef.current?.uid;
    const cachedResolution = principalUid
      ? readSignedInMembershipCache(principalUid)
      : undefined;
    if (
      principalUid
      && cachedResolution?.kind === 'membership-found'
      && cachedResolution.membership.householdId === household.id
      && cachedResolution.membership.memberId === updated.id
    ) {
      writeSignedInMembershipCache(principalUid, {
        ...cachedResolution,
        membership: {
          ...cachedResolution.membership,
          displayName: updated.name,
          aggregateVersion: updated.aggregateVersion,
        },
        household: householdToResolutionView(updatedHousehold),
      });
    }
  }, [currentMember, household]);

  return (
    <HouseholdContext.Provider value={{
      household,
      householdKey,
      isLoading: sessionState === 'resolving',
      isAuthenticated: sessionState === 'ready',
      isSessionVerified,
      remoteSessionStatus,
      remoteReadEpoch,
      currentMember,
      sessionState,
      sessionError,
      legacyCandidate,
      adminHouseholdView,
      signIn,
      retrySession,
      recoverRemoteSession,
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
