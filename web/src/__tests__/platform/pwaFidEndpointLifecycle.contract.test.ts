import type { Messaging } from 'firebase/messaging';
import { waitFor } from '@testing-library/react';

const mockMessaging = {} as Messaging;
let mockRegisteredHandler: ((fid: string) => void) | undefined;
let mockUnregisteredHandler: ((fid: string) => void) | undefined;
let mockForegroundHandler: ((payload: {
  notification?: { title?: string; body?: string };
  data?: Record<string, string>;
}) => void) | undefined;
const mockShowNotification = jest.fn(async () => undefined);
let mockSubscriptionEndpoint = 'https://push.example/root-subscription';
const mockGetSubscription = jest.fn(async (): Promise<{ endpoint: string; getKey: () => ArrayBuffer } | null> => ({
  endpoint: mockSubscriptionEndpoint,
  getKey: () => new Uint8Array([1, 2, 3]).buffer,
}));
const mockRootRegistration = {
  scope: 'https://app.example/', active: { state: 'activated' },
  pushManager: { getSubscription: mockGetSubscription }, showNotification: mockShowNotification,
};
const mockEnsureMessagingWorker = jest.fn(async () => mockRootRegistration);
const mockRetireLegacyWorkers = jest.fn(async (assertCurrent: () => void) => assertCurrent());
const mockRegister = jest.fn(async (..._args: unknown[]) => {
  mockRegisteredHandler?.('fid-current-installation');
});
const mockRegisterEndpoint = jest.fn();
const mockRemoveEndpoint = jest.fn(async (..._args: unknown[]) => undefined);
const mockSdkRemoveEndpoint = jest.fn(async (..._args: unknown[]) => undefined);
const mockUnregister = jest.fn(async () => { mockUnregisteredHandler?.('fid-current-installation'); });
const mockGetInstallationId = jest.fn(async () => 'fid-current-installation');
jest.mock('firebase/installations', () => ({ getInstallations: jest.fn(() => ({})), getId: () => mockGetInstallationId() }));
jest.mock('@/platform/pwa/browserServiceWorker', () => ({
  ensurePwaServiceWorker: jest.fn(async () => mockRootRegistration),
  ensurePwaMessagingServiceWorker: (...args: []) => mockEnsureMessagingWorker(...args),
  retireLegacyPwaMessagingWorkers: (...args: [() => void]) => mockRetireLegacyWorkers(...args),
}));

jest.mock('firebase/messaging', () => ({
  getMessaging: jest.fn(() => mockMessaging),
  isSupported: jest.fn(async () => true),
  onMessage: jest.fn((_messaging, handler) => {
    mockForegroundHandler = handler;
    return jest.fn();
  }),
  onRegistered: jest.fn((_messaging, handler) => {
    mockRegisteredHandler = handler;
    return jest.fn(() => { if (mockRegisteredHandler === handler) mockRegisteredHandler = undefined; });
  }),
  onUnregistered: jest.fn((_messaging, handler) => {
    mockUnregisteredHandler = handler;
    return jest.fn(() => { if (mockUnregisteredHandler === handler) mockUnregisteredHandler = undefined; });
  }),
  register: (...args: unknown[]) => mockRegister(...args),
  unregister: () => mockUnregister(),
}));

jest.mock('@/lib/firebaseApp', () => ({ app: {} }));

jest.mock('@/features/notifications/application/notificationCommands', () => ({
  notificationCommands: {
    registerEndpoint: (...args: unknown[]) => mockRegisterEndpoint(...args),
    removeEndpointForLogout: (...args: unknown[]) => mockRemoveEndpoint(...args),
    removeEndpointForSdkUnregistered: (...args: unknown[]) => mockSdkRemoveEndpoint(...args),
  },
}));

const mockSessionScope = {
  sessionGeneration: 7,
  principalUid: 'uid-1',
  householdId: 'household-1',
  memberId: 'member-1',
};

jest.mock('@/composition/clientSessionScope', () => ({
  getClientSessionScope: jest.fn(() => mockSessionScope),
  requireClientSessionScope: jest.fn(() => mockSessionScope),
}));

jest.mock('@/lib/utils/platform', () => ({
  Platform: {
    isIOSPWA: jest.fn(() => true),
    supportsPushNotification: jest.fn(() => true),
    isServer: jest.fn(() => false),
    supportsNotification: jest.fn(() => true),
  },
}));

import {
  activatePwaFidEndpoint,
  getPwaFidEndpointRegistrationState,
  subscribePwaFidEndpointRegistrationState,
  removePwaFidEndpointForLogout,
  completePwaSessionCleanup,
} from '@/platform/pwa/fidEndpointLifecycle';
import {
  formatPwaEndpointRegistrationErrorCode,
  type PwaEndpointRegistrationPhase,
} from '@/platform/pwa/pwaEndpointRegistrationDiagnostic';

describe('iPhone PWA FID endpoint 등록 계약', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: require('node:crypto').webcrypto });
    Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: require('node:util').TextEncoder });
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: {
        permission: 'granted',
        requestPermission: jest.fn(async () => 'granted'),
      },
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: jest.fn(async () => undefined),
        getRegistration: jest.fn(async () => ({
          scope: '/firebase-cloud-messaging-push-scope',
          showNotification: mockShowNotification,
        })),
      },
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    completePwaSessionCleanup();
    localStorage.removeItem('pwa-fid-root-binding.v1');
    mockSubscriptionEndpoint = 'https://push.example/root-subscription';
    mockRegisterEndpoint.mockResolvedValue({ registrationVersion: 99 });
  });

  it('[T-PUSH-008] 권한 허용만으로 활성 처리하지 않고 같은 FID도 서버 재등록 성공 뒤 활성 처리한다', async () => {
    mockRegisterEndpoint
      .mockResolvedValueOnce({ registrationVersion: 11 })
      .mockResolvedValueOnce({ registrationVersion: 12 });
    const observedStatuses: string[] = [];
    const unsubscribe = subscribePwaFidEndpointRegistrationState((state) => {
      observedStatuses.push(state.status);
    });

    await expect(activatePwaFidEndpoint()).resolves.toBe(true);
    expect(mockRegisterEndpoint).toHaveBeenLastCalledWith(
      'household-1',
      'fid-current-installation',
      'ios-pwa'
    );
    expect(getPwaFidEndpointRegistrationState()).toEqual({
      status: 'active',
      registrationVersion: 11,
    });

    await expect(activatePwaFidEndpoint()).resolves.toBe(true);
    expect(mockRegisterEndpoint).toHaveBeenCalledTimes(2);
    expect(getPwaFidEndpointRegistrationState()).toEqual({
      status: 'active',
      registrationVersion: 12,
    });
    expect(observedStatuses).toEqual([
      ...Array(9).fill('registering'),
      'active',
      ...Array(7).fill('registering'),
      'active',
    ]);
    expect(mockRegister).toHaveBeenCalledTimes(3); // prime + reconnect, then cached activation
    expect(mockUnregister).toHaveBeenCalledTimes(1);
    expect(mockSdkRemoveEndpoint).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('[T-PUSH-008] 서버 등록이 실패하면 활성 상태로 표시하지 않는다', async () => {
    mockRegisterEndpoint.mockRejectedValueOnce(new Error('REGISTER_ENDPOINT_FAILED'));

    await expect(activatePwaFidEndpoint()).rejects.toThrow('REGISTER_ENDPOINT_FAILED');
    expect(getPwaFidEndpointRegistrationState()).toEqual({ status: 'error', phase: 'server-registration', errorCode: 'unknown' });
    expect(mockRetireLegacyWorkers).not.toHaveBeenCalled();
    expect(localStorage.getItem('pwa-fid-root-binding.v1')).toBeNull();
  });

  it('[T-PUSH-004][PUSH-006] PWA가 열린 상태에서도 안전한 지출 payload를 시스템 알림으로 표시한다', async () => {
    mockRegisterEndpoint.mockResolvedValueOnce({ registrationVersion: 13 });
    await activatePwaFidEndpoint();

    mockForegroundHandler?.({
      notification: {
        title: '가계부 알림',
        body: '새 지출 내역을 확인해 주세요.',
      },
      data: {
        payloadVersion: 'notification-payload.v1',
        type: 'household-notification-requested',
        clickTarget: 'expense-edit',
        expenseId: 'expense_A-1.2',
      },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(mockShowNotification).toHaveBeenCalledWith('가계부 알림', {
      body: '새 지출 내역을 확인해 주세요.',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      data: {
        payloadVersion: 'notification-payload.v1',
        type: 'household-notification-requested',
        clickTarget: 'expense-edit',
        expenseId: 'expense_A-1.2',
      },
    });
  });

  it('[T-PUSH-004][PUSH-011] 열린 PWA는 지출 수정 계약이 아닌 payload를 표시하지 않는다', async () => {
    mockForegroundHandler?.({
      notification: { title: '알 수 없는 알림' },
      data: {
        payloadVersion: 'notification-payload.v2',
        type: 'household-notification-requested',
        clickTarget: 'external-url',
        expenseId: '../admin',
      },
    });
    await Promise.resolve();

    expect(mockShowNotification).not.toHaveBeenCalled();
  });

  it('삭제 실패와 후속 purge 대기 중에는 등록을 차단하고 재시도 뒤에만 연다', async () => {
    mockRemoveEndpoint.mockRejectedValueOnce(new Error('OFFLINE'));
    await expect(removePwaFidEndpointForLogout()).rejects.toThrow('OFFLINE');
    await expect(activatePwaFidEndpoint()).rejects.toThrow('PWA_SESSION_CLEANUP_REQUIRED');
    expect(mockRegisterEndpoint).not.toHaveBeenCalled();
    await removePwaFidEndpointForLogout();
    await expect(activatePwaFidEndpoint()).rejects.toThrow('PWA_SESSION_CLEANUP_REQUIRED');
    completePwaSessionCleanup();
    mockRegisterEndpoint.mockResolvedValueOnce({ registrationVersion: 14 });
    await expect(activatePwaFidEndpoint()).resolves.toBe(true);
  });

  it('새 worker 준비 실패는 기존 연결과 완료 marker를 건드리지 않는다', async () => {
    await activatePwaFidEndpoint();
    jest.clearAllMocks();
    localStorage.setItem('pwa-fid-root-binding.v1', 'existing-marker');
    mockEnsureMessagingWorker.mockRejectedValueOnce(new Error('PWA_PUSH_WORKER_NOT_READY'));
    await expect(activatePwaFidEndpoint()).rejects.toThrow('PWA_PUSH_WORKER_NOT_READY');
    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockUnregister).not.toHaveBeenCalled();
    expect(mockRetireLegacyWorkers).not.toHaveBeenCalled();
    expect(localStorage.getItem('pwa-fid-root-binding.v1')).toBe('existing-marker');
    mockForegroundHandler?.({ data: {
      payloadVersion: 'notification-payload.v1', type: 'expense-created', clickTarget: 'expense-edit', expenseId: 'after-update-failure',
    } });
    await waitFor(() => expect(mockShowNotification).toHaveBeenCalledTimes(1));
  });

  it('동일 FID도 root 구독이 바뀌면 한 번 재연결하고 SDK 삭제 callback을 서버 삭제로 전달하지 않는다', async () => {
    await activatePwaFidEndpoint();
    const firstMarker = localStorage.getItem('pwa-fid-root-binding.v1');
    mockSubscriptionEndpoint = 'https://push.example/replaced-subscription';
    await activatePwaFidEndpoint();
    expect(mockUnregister).toHaveBeenCalledTimes(2);
    expect(mockRegister).toHaveBeenCalledTimes(4);
    expect(mockRegisterEndpoint).toHaveBeenCalledTimes(2);
    expect(mockSdkRemoveEndpoint).not.toHaveBeenCalled();
    expect(localStorage.getItem('pwa-fid-root-binding.v1')).not.toBe(firstMarker);
    await activatePwaFidEndpoint();
    expect(mockUnregister).toHaveBeenCalledTimes(2);
    expect(mockRegister).toHaveBeenCalledTimes(5);
  });

  it('신규 root 구독은 prime 중 서버 등록이나 active를 발행하지 않고 최종 연결 뒤에만 완료한다', async () => {
    let primed = false;
    mockGetSubscription.mockResolvedValueOnce(null);
    mockRegister.mockImplementationOnce(async () => {
      primed = true;
      mockRegisteredHandler?.('fid-current-installation');
      expect(mockRegisterEndpoint).not.toHaveBeenCalled();
      expect(getPwaFidEndpointRegistrationState()).toEqual({ status: 'registering', phase: 'prime-registration' });
    });
    mockUnregister.mockImplementationOnce(async () => {
      if (!primed) throw new Error('FID_NOT_FOUND');
      expect(mockRegisterEndpoint).not.toHaveBeenCalled();
      expect(getPwaFidEndpointRegistrationState()).toEqual({ status: 'registering', phase: 'unregister' });
      mockUnregisteredHandler?.('fid-current-installation');
    });
    await expect(activatePwaFidEndpoint()).resolves.toBe(true);
    expect(mockRegister).toHaveBeenCalledTimes(2);
    expect(mockRegisterEndpoint).toHaveBeenCalledTimes(1);
    expect(mockSdkRemoveEndpoint).not.toHaveBeenCalled();
    expect(localStorage.getItem('pwa-fid-root-binding.v1')).not.toBeNull();
  });

  it('SDK 재연결 실패 뒤 legacy와 marker 미완료 상태를 유지하고 재시도한다', async () => {
    mockUnregister.mockRejectedValueOnce(new Error('FCM_UNAVAILABLE'));
    await expect(activatePwaFidEndpoint()).rejects.toThrow('FCM_UNAVAILABLE');
    expect(mockRegisterEndpoint).not.toHaveBeenCalled();
    expect(mockRetireLegacyWorkers).not.toHaveBeenCalled();
    expect(localStorage.getItem('pwa-fid-root-binding.v1')).toBeNull();
    await expect(activatePwaFidEndpoint()).resolves.toBe(true);
    expect(mockRegisterEndpoint).toHaveBeenCalledTimes(1);
    expect(mockRetireLegacyWorkers).toHaveBeenCalledTimes(1);
  });

  it('prime 완료를 기다리는 로그아웃은 최종 재등록이나 legacy 정리를 시작하지 않는다', async () => {
    let finishPrime!: () => void;
    mockRegister.mockImplementationOnce(() => new Promise<void>(resolve => {
      const handler = mockRegisteredHandler;
      finishPrime = () => { handler?.('fid-current-installation'); resolve(); };
    }));
    const activation = expect(activatePwaFidEndpoint()).rejects.toThrow('PWA_ENDPOINT_SCOPE_CHANGED');
    await waitFor(() => expect(finishPrime).toBeDefined());
    const logout = removePwaFidEndpointForLogout();
    finishPrime();
    await activation;
    await logout;
    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(mockRegisterEndpoint).not.toHaveBeenCalled();
    expect(mockRetireLegacyWorkers).not.toHaveBeenCalled();
    expect(localStorage.getItem('pwa-fid-root-binding.v1')).toBeNull();
    completePwaSessionCleanup();
    await activatePwaFidEndpoint();
  });

  it('로그아웃은 마지막 callback뿐 아니라 미완료 서버 등록을 모두 기다린 뒤 endpoint를 삭제한다', async () => {
    await activatePwaFidEndpoint();
    let finishFirst!: (value: { registrationVersion: number }) => void;
    let finishSecond!: (value: { registrationVersion: number }) => void;
    mockRegisterEndpoint
      .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve; }));
    mockRegisteredHandler?.('fid-current-installation');
    mockRegisteredHandler?.('fid-current-installation');
    const logout = removePwaFidEndpointForLogout();
    finishSecond({ registrationVersion: 101 });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockRemoveEndpoint).not.toHaveBeenCalled();
    finishFirst({ registrationVersion: 100 });
    await logout;
    expect(mockRemoveEndpoint).toHaveBeenCalledWith('household-1', 'fid-current-installation');
    expect(getPwaFidEndpointRegistrationState()).toEqual({ status: 'idle' });
    completePwaSessionCleanup();
    await activatePwaFidEndpoint();
  });

  it('등록 진행 단계를 순서대로 표시하고 SDK callback 뒤 서버 응답을 기다린다', async () => {
    const phases: PwaEndpointRegistrationPhase[] = [];
    const stop = subscribePwaFidEndpointRegistrationState(state => {
      if (state.status === 'registering' && state.phase) phases.push(state.phase);
    });
    let completeServer!: (value: { registrationVersion: number }) => void;
    mockRegisterEndpoint.mockImplementationOnce(() => new Promise(resolve => { completeServer = resolve; }));
    const activation = activatePwaFidEndpoint();
    await waitFor(() => expect(completeServer).toBeDefined());
    expect(getPwaFidEndpointRegistrationState()).toEqual({ status: 'registering', phase: 'server-registration' });
    expect(mockRetireLegacyWorkers).not.toHaveBeenCalled();
    completeServer({ registrationVersion: 120 });
    await activation;
    expect(phases).toEqual([
      'worker', 'installation', 'subscription', 'prime-registration', 'unregister',
      'push-registration', 'server-registration', 'verification', 'legacy-cleanup',
    ]);
    expect(getPwaFidEndpointRegistrationState()).toEqual({ status: 'active', registrationVersion: 120 });
    stop();
  });

  it.each<PwaEndpointRegistrationPhase>([
    'worker', 'installation', 'subscription', 'prime-registration', 'unregister',
    'push-registration', 'server-registration', 'verification', 'legacy-cleanup',
  ])('%s 실패는 정확한 단계와 안전한 SDK 코드만 보존한다', async phase => {
    const error = Object.assign(new Error('secret-fid https://push.example/private-endpoint'), {
      code: phase === 'installation' ? 'installations/request-failed' : 'messaging/fid-registration-failed',
      customData: { errorInfo: 'private-fid and backend URL' },
    });
    if (phase === 'worker') mockEnsureMessagingWorker.mockRejectedValueOnce(error);
    if (phase === 'installation') mockGetInstallationId.mockRejectedValueOnce(error);
    if (phase === 'subscription') mockGetSubscription.mockRejectedValueOnce(error);
    if (phase === 'prime-registration') mockRegister.mockRejectedValueOnce(error);
    if (phase === 'unregister') mockUnregister.mockRejectedValueOnce(error);
    if (phase === 'push-registration') {
      mockRegister.mockImplementationOnce(async () => { mockRegisteredHandler?.('fid-current-installation'); })
        .mockRejectedValueOnce(error);
    }
    if (phase === 'server-registration') mockRegisterEndpoint.mockRejectedValueOnce(error);
    if (phase === 'verification') {
      mockGetSubscription.mockResolvedValueOnce({ endpoint: mockSubscriptionEndpoint, getKey: () => new Uint8Array([1, 2, 3]).buffer })
        .mockRejectedValueOnce(error);
    }
    if (phase === 'legacy-cleanup') mockRetireLegacyWorkers.mockRejectedValueOnce(error);

    await expect(activatePwaFidEndpoint()).rejects.toBe(error);
    expect(getPwaFidEndpointRegistrationState()).toEqual({ status: 'error', phase, errorCode: error.code });
    expect(localStorage.getItem('pwa-fid-root-binding.v1')).toBeNull();
  });

  it('오류 formatter는 원문과 customData를 반환하지 않고 허용된 코드만 추출한다', () => {
    expect(formatPwaEndpointRegistrationErrorCode({ code: 'functions/unavailable', message: 'private', customData: { errorInfo: 'private' } })).toBe('functions/unavailable');
    expect(formatPwaEndpointRegistrationErrorCode(new DOMException('private push endpoint', 'NotAllowedError'))).toBe('NotAllowedError');
    expect(formatPwaEndpointRegistrationErrorCode(new Error('PWA_PUSH_WORKER_NOT_READY'))).toBe('PWA_PUSH_WORKER_NOT_READY');
    expect(formatPwaEndpointRegistrationErrorCode(new Error('PWA_SESSION_CLEANUP_REQUIRED'))).toBe('PWA_SESSION_CLEANUP_REQUIRED');
    expect(formatPwaEndpointRegistrationErrorCode(new Error('LEGACY_WORKER_CLEANUP_FAILED'))).toBe('LEGACY_WORKER_CLEANUP_FAILED');
    for (const unknown of [
      undefined, null, 'PWA_UNSUPPORTED', new Error('private-fid https://push.example/secret'),
      { code: 'messaging/failure https://push.example/secret' },
      { code: 'installations/private/fid' },
      { code: 'PWA_PRIVATE_FID', message: 'PWA_PRIVATE_FID' },
      { code: 'unknown/provider', customData: { errorInfo: 'NOT_FOUND' } },
    ]) expect(formatPwaEndpointRegistrationErrorCode(unknown)).toBe('unknown');
  });

  it('actor가 바뀐 뒤 늦게 도착한 등록 callback과 foreground는 새 actor에 전달하지 않는다', async () => {
    mockSessionScope.sessionGeneration++;
    mockSessionScope.memberId = 'member-2';
    mockRegisteredHandler?.('late-fid');
    mockForegroundHandler?.({ data: {
      payloadVersion: 'notification-payload.v1', type: 'expense-created', clickTarget: 'expense-edit', expenseId: 'expense-1',
    } });
    await Promise.resolve();
    expect(mockRegisterEndpoint).not.toHaveBeenCalled();
    expect(mockShowNotification).not.toHaveBeenCalled();
    await expect(activatePwaFidEndpoint()).rejects.toThrow('PWA_SESSION_CLEANUP_REQUIRED');
  });
});
