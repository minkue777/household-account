'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { User } from 'firebase/auth';
import type { Household, HouseholdMember } from '@/types/household';
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
  getSignedInMembershipRevalidationDelay,
  invalidateSignedInMembershipVerification,
  readLastSignedInSessionCache,
  readSignedInHouseholdCache,
  readSignedInMembershipCache,
  writeSignedInMembershipCache,
  type SignedInUserResolution,
} from '@/features/access-household/application/signedInMembershipCache';
import {
  markWebAuthCompleted,
  markWebAuthStarted,
  markWebBootstrapCacheResult,
  markWebBootstrapStarted,
  markWebHouseholdCacheResult,
  markWebHouseholdCompleted,
  markWebHouseholdStarted,
  markWebMembershipCacheUsed,
  markWebMembershipCompleted,
  markWebMembershipPrefetched,
  markWebMembershipStarted,
  scheduleAfterWebFirstLedgerPaint,
} from '@/platform/performance/webStartupPerformance';

const AUTH_BOOTSTRAP_TIMEOUT_MS = 60_000;
const SESSION_RESOLUTION_TIMEOUT_MS = 20_000;
const HOUSEHOLD_READ_TIMEOUT_MS = 20_000;
const MEMBERSHIP_REVALIDATION_FALLBACK_MS = 15_000;
const MEMBERSHIP_REVALIDATION_SETTLE_MS = 5_000;
const MEMBERSHIP_REVALIDATION_RETRY_MS = 5 * 60 * 1_000;

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

interface HouseholdContextType {
  household: Household | null;
  householdKey: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isSessionVerified: boolean;
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

function isHouseholdReadNotFound(error: unknown): boolean {
  return error instanceof Error
    && (
      error.name === 'HouseholdReadNotFoundError'
      || error.message === 'HOUSEHOLD_READ_NOT_FOUND'
    );
}

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const paintBootstrapRef = useRef<ReturnType<typeof readLastSignedInSessionCache>>(undefined);
  const [household, setHousehold] = useState<Household | null>(null);
  const [householdKey, setHouseholdKey] = useState<string | null>(null);
  const [currentMember, setCurrentMember] = useState<HouseholdMember | null>(null);
  const [sessionState, setSessionState] = useState<HouseholdSessionState>('resolving');
  const [isSessionVerified, setIsSessionVerified] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [legacyCandidate, setLegacyCandidate] = useState<LegacySessionCandidate | null>(null);
  const [adminHouseholdView, setAdminHouseholdView] =
    useState<AdminHouseholdViewSelection | null>(null);
  const activeUserRef = useRef<User | null>(null);
  const resolutionGenerationRef = useRef(0);
  const sessionGenerationRef = useRef(0);
  const endpointRegistrationGenerationRef = useRef(0);

  useLayoutEffect(() => {
    const cached = readLastSignedInSessionCache();
    paintBootstrapRef.current = cached;
    markWebBootstrapCacheResult(cached !== undefined);
    if (!cached) return;
    const member = cached.household.members.find(
      (candidate) => candidate.id === cached.resolution.membership.memberId
    );
    if (!member) return;
    sessionGenerationRef.current = 1;
    setClientSessionScope({
      sessionGeneration: 1,
      principalUid: cached.principalUid,
      householdId: cached.resolution.membership.householdId,
      memberId: cached.resolution.membership.memberId,
      accessMode: 'member',
    });
    setHousehold(cached.household);
    setHouseholdKey(cached.resolution.membership.householdId);
    setCurrentMember(member);
    setSessionState('ready');
  }, []);

  const clearResolvedSession = useCallback(() => {
    resetClientOptimisticProjections();
    clearClientSessionScope();
    setHousehold(null);
    setHouseholdKey(null);
    setCurrentMember(null);
    setAdminHouseholdView(null);
    setIsSessionVerified(false);
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
    prefetchedResolution?: SignedInUserResolution,
    options: {
      preservePaintBootstrap?: boolean;
      membershipSource?: 'last-verified-cache' | 'authoritative-prefetch';
    } = {}
  ) => {
    const resolutionGeneration = ++resolutionGenerationRef.current;
    setSessionError(null);
    if (!options.preservePaintBootstrap) {
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
          const [
            { initializeFirebaseAppCheck },
            { householdCommands },
          ] = await Promise.all([
            import('@/platform/security/firebaseAppCheck'),
            import('@/features/access-household/application/householdCommands'),
          ]);
          initializeFirebaseAppCheck();
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
      writeSignedInMembershipCache(
        user.uid,
        resolution,
        undefined,
        {
          preserveVerificationTime:
            options.membershipSource === 'last-verified-cache',
        }
      );

      const resolvedSelf: HouseholdMember = {
        id: membership.memberId,
        name: membership.displayName,
        aggregateVersion: membership.aggregateVersion,
      };
      const sessionGeneration = ++sessionGenerationRef.current;
      setIsSessionVerified(true);

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
        }, normalizedHousehold, { preserveVerificationTime: true });
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

      const { getCachedHousehold, getHousehold } = await import('@/lib/householdService');
      const cachedHousehold = fastHousehold
        ?? await getCachedHousehold(membership.householdId);
      markWebHouseholdCacheResult(cachedHousehold !== null && cachedHousehold !== undefined);
      if (!fastHousehold && cachedHousehold) applyHousehold(cachedHousehold);

      try {
        markWebHouseholdStarted();
        let loadedHousehold: Household;
        try {
          loadedHousehold = await withinDeadline(
            getHousehold(membership.householdId),
            HOUSEHOLD_READ_TIMEOUT_MS,
            'HOUSEHOLD_READ_TIMEOUT'
          );
          markWebHouseholdCompleted(true);
        } catch (error) {
          markWebHouseholdCompleted(false);
          throw error;
        }
        applyHousehold(loadedHousehold);
      } catch (error) {
        // 검증된 membership과 캐시로 이미 화면을 복구했다면 일시적인 read
        // 장애 때문에 다시 전체 화면을 막지 않습니다.
        if (
          isHouseholdReadNotFound(error)
          || !cachedHousehold
          || !isTransientHouseholdReadFailure(error)
        ) {
          throw error;
        }
      }
    } catch (error) {
      if (resolutionGeneration !== resolutionGenerationRef.current) return;
      if (
        options.membershipSource === 'last-verified-cache'
        && !isTransientHouseholdReadFailure(error)
      ) {
        invalidateSignedInMembershipVerification(user.uid);
      }
      if (
        options.preservePaintBootstrap
        && !isHouseholdReadNotFound(error)
      ) {
        // The cached UI remains useful during a transient background verification failure.
        // Remote reads and writes are still rejected by Firebase until Auth/App Check recover.
        setIsSessionVerified(false);
        setSessionState('ready');
        return;
      }
      clearSignedInMembershipCache();
      clearResolvedSession();
      setSessionError(errorMessage(error));
      setSessionState('error');
    }
  }, [clearResolvedSession]);

  useEffect(() => {
    let disposed = false;
    let unsubscribeAuth: (() => void) | undefined;
    let androidBootstrapPending = isAndroidHostAvailable();
    let androidBootstrapStarted = false;
    let appliedAuthUid: string | null | undefined;
    let appliedResolutionKey: string | undefined;
    let membershipRevalidationDelayId: number | undefined;
    let cancelPostPaintRevalidation: (() => void) | undefined;
    let authStartFrameId: number | undefined;
    let authStartDelayId: number | undefined;
    let authStartFallbackId: number | undefined;
    let authObserverStartRequested = false;

    const resolutionKey = (resolution?: SignedInUserResolution): string | undefined =>
      resolution?.kind === 'membership-found'
        ? `${resolution.membership.householdId}\u0000${resolution.membership.memberId}`
        : resolution?.kind;

    const cancelMembershipRevalidation = () => {
      if (membershipRevalidationDelayId !== undefined) {
        window.clearTimeout(membershipRevalidationDelayId);
        membershipRevalidationDelayId = undefined;
      }
      cancelPostPaintRevalidation?.();
      cancelPostPaintRevalidation = undefined;
    };

    const scheduleMembershipRevalidation = (
      user: User,
      minimumDelayMs = 0
    ) => {
      cancelMembershipRevalidation();
      const cachedDelay = getSignedInMembershipRevalidationDelay(user.uid);
      if (cachedDelay === undefined) return;

      membershipRevalidationDelayId = window.setTimeout(() => {
        membershipRevalidationDelayId = undefined;
        if (disposed || activeUserRef.current?.uid !== user.uid) return;

        const refreshedDelay = getSignedInMembershipRevalidationDelay(user.uid);
        if (refreshedDelay === undefined) return;
        if (refreshedDelay > 0) {
          scheduleMembershipRevalidation(user);
          return;
        }

        cancelPostPaintRevalidation = scheduleAfterWebFirstLedgerPaint(
          () => {
            cancelPostPaintRevalidation = undefined;
            if (disposed || activeUserRef.current?.uid !== user.uid) return;
            void restoreSignedInUser(
              user,
              undefined,
              undefined,
              { preservePaintBootstrap: true }
            ).finally(() => {
              if (!disposed && activeUserRef.current?.uid === user.uid) {
                scheduleMembershipRevalidation(user, MEMBERSHIP_REVALIDATION_RETRY_MS);
              }
            });
          },
          {
            delayAfterPaintMs: MEMBERSHIP_REVALIDATION_SETTLE_MS,
            fallbackMs: MEMBERSHIP_REVALIDATION_FALLBACK_MS,
            idleTimeoutMs: 5_000,
          }
        );
      }, Math.max(cachedDelay, minimumDelayMs));
    };

    const applyUser = (
      user: User | null,
      prefetchedResolution?: SignedInUserResolution,
      preservePaintBootstrap = false,
      membershipSource?: 'last-verified-cache' | 'authoritative-prefetch'
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
        cancelMembershipRevalidation();
        resolutionGenerationRef.current += 1;
        clearResolvedSession();
        setLegacyCandidate(null);
        setSessionError(null);
        setSessionState('signed-out');
        return;
      }
      setIsSessionVerified(true);
      const adminSelection = readAdminHouseholdViewSelection();
      if (adminSelection !== null && !isAndroidHostAvailable()) {
        void restoreAdministratorHouseholdView(user, adminSelection);
        return;
      }
      const restoration = restoreSignedInUser(
        user,
        captureLegacySessionCandidate(),
        prefetchedResolution,
        { preservePaintBootstrap, membershipSource }
      );
      // 검증 시각이 있는 cache를 사용했다면 authoritative household read가 오래
      // 걸리더라도 Membership 재검증 예약 자체는 지연시키지 않습니다.
      scheduleMembershipRevalidation(user);
      void restoration.finally(() => {
        if (!disposed && activeUserRef.current?.uid === user.uid) {
          scheduleMembershipRevalidation(user);
        }
      });
    };

    const startAndroidBootstrap = () => {
      if (disposed || !androidBootstrapPending || androidBootstrapStarted) return;
      androidBootstrapStarted = true;
      void loadAuthService().then(({ restoreAndroidHostAuth }) => withinDeadline(
        restoreAndroidHostAuth(),
        AUTH_BOOTSTRAP_TIMEOUT_MS,
        'ANDROID_AUTH_BOOTSTRAP_TIMEOUT'
      )).then((session) => {
        if (disposed || !androidBootstrapPending) return;
        androidBootstrapPending = false;
        markWebAuthCompleted(true);
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
          session?.signedInUserResolution,
          session?.user.uid === paintBootstrapRef.current?.principalUid,
          session?.signedInUserResolution === undefined
            ? undefined
            : 'authoritative-prefetch'
        );
      }).catch((error) => {
        if (disposed || !androidBootstrapPending) return;
        androidBootstrapPending = false;
        markWebAuthCompleted(false);
        if (paintBootstrapRef.current !== undefined) return;
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
        // 영속 Web Auth가 복원되면 매 실행마다 Native custom-token을 다시
        // 발급하지 않습니다. Firebase SDK의 token refresh와 서버 rules가 실제
        // read/write 권한을 계속 검증합니다.
        if (user) {
          androidBootstrapPending = false;
          const preservesPaint = user.uid === paintBootstrapRef.current?.principalUid;
          applyUser(
            user,
            cachedResolution,
            preservesPaint,
            cachedResolution ? 'last-verified-cache' : undefined
          );
        } else if (!user) {
          startAndroidBootstrap();
        }
        return;
      }
      const preservesPaint = user?.uid === paintBootstrapRef.current?.principalUid;
      applyUser(
        user,
        cachedResolution,
        preservesPaint,
        cachedResolution ? 'last-verified-cache' : undefined
      );
    };

    const startAuthObserver = () => {
      if (disposed || authObserverStartRequested) return;
      authObserverStartRequested = true;
      if (authStartFrameId !== undefined) window.cancelAnimationFrame(authStartFrameId);
      if (authStartDelayId !== undefined) window.clearTimeout(authStartDelayId);
      if (authStartFallbackId !== undefined) window.clearTimeout(authStartFallbackId);
      markWebAuthStarted();

      // Firebase Auth SDK는 캐시된 첫 화면 표시의 선행 조건이 아닙니다. 인증 모듈을
      // 별도 청크로 늦게 불러오되, 화면 표시 후에는 기존과 동일하게 Auth observer와
      // Android native custom-token 복구를 시작합니다.
      void loadAuthService().then(({ onAuthChange }) => {
        if (disposed) return;
        unsubscribeAuth = onAuthChange(handleAuthChange);

        // 마지막 화면 캐시가 없는 Android 첫 실행은 Auth observer와 Native 세션 복구를
        // 병렬로 시작합니다. 기존의 고정 500ms 대기는 두 경로 모두에 불필요한 지연이었습니다.
        if (androidBootstrapPending && paintBootstrapRef.current === undefined) {
          startAndroidBootstrap();
        }
      })
      .catch((error) => {
        if (disposed) return;
        markWebAuthCompleted(false);
        if (paintBootstrapRef.current !== undefined) return;
        clearResolvedSession();
        setSessionError(errorMessage(error));
        setSessionState('error');
      });
    };

    if (
      paintBootstrapRef.current !== undefined
      && typeof window.requestAnimationFrame === 'function'
    ) {
      // useLayoutEffect가 cache state를 적용하면 React가 passive effect를 paint 전에
      // 실행할 수도 있으므로 rAF 다음 task에서 Auth 청크를 시작합니다.
      authStartFrameId = window.requestAnimationFrame(() => {
        authStartFrameId = undefined;
        authStartDelayId = window.setTimeout(startAuthObserver, 0);
      });
      // background tab처럼 rAF가 멈춘 환경에서도 인증 검증이 영구 정지하지 않습니다.
      authStartFallbackId = window.setTimeout(startAuthObserver, 1_000);
    } else {
      startAuthObserver();
    }

    return () => {
      disposed = true;
      cancelMembershipRevalidation();
      if (authStartFrameId !== undefined) window.cancelAnimationFrame(authStartFrameId);
      if (authStartDelayId !== undefined) window.clearTimeout(authStartDelayId);
      if (authStartFallbackId !== undefined) window.clearTimeout(authStartFallbackId);
      unsubscribeAuth?.();
    };
  }, [
    clearResolvedSession,
    restoreAdministratorHouseholdView,
    restoreSignedInUser,
  ]);

  const signIn = useCallback(async () => {
    const candidate = captureLegacySessionCandidate();
    setLegacyCandidate(candidate ?? null);
    setSessionError(null);
    try {
      const { signInWithGoogleSession } = await loadAuthService();
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
      isSessionVerified,
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
