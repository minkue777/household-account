import type { Messaging } from 'firebase/messaging';

const mockMessaging = {} as Messaging;
let mockRegisteredHandler: ((fid: string) => void) | undefined;
let mockForegroundHandler: ((payload: {
  notification?: { title?: string; body?: string };
  data?: Record<string, string>;
}) => void) | undefined;
const mockShowNotification = jest.fn(async () => undefined);
const mockRegister = jest.fn(async (..._args: unknown[]) => {
  mockRegisteredHandler?.('fid-current-installation');
});
const mockRegisterEndpoint = jest.fn();
const mockRemoveEndpoint = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('firebase/installations', () => ({ getInstallations: jest.fn(() => ({})), getId: jest.fn(async () => 'fid-current-installation') }));
jest.mock('@/platform/pwa/browserServiceWorker', () => ({ ensurePwaServiceWorker: jest.fn(async () => ({ scope: '/', showNotification: mockShowNotification })) }));

jest.mock('firebase/messaging', () => ({
  getMessaging: jest.fn(() => mockMessaging),
  isSupported: jest.fn(async () => true),
  onMessage: jest.fn((_messaging, handler) => {
    mockForegroundHandler = handler;
    return jest.fn();
  }),
  onRegistered: jest.fn((_messaging, handler) => {
    mockRegisteredHandler = handler;
    return jest.fn();
  }),
  onUnregistered: jest.fn(() => jest.fn()),
  register: (...args: unknown[]) => mockRegister(...args),
  unregister: jest.fn(async () => undefined),
}));

jest.mock('@/lib/firebaseApp', () => ({ app: {} }));

jest.mock('@/features/notifications/application/notificationCommands', () => ({
  notificationCommands: {
    registerEndpoint: (...args: unknown[]) => mockRegisterEndpoint(...args),
    removeEndpointForLogout: (...args: unknown[]) => mockRemoveEndpoint(...args),
    removeEndpointForSdkUnregistered: jest.fn(async () => undefined),
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

describe('iPhone PWA FID endpoint 등록 계약', () => {
  beforeAll(() => {
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
      'registering',
      'active',
      'registering',
      'active',
    ]);
    unsubscribe();
  });

  it('[T-PUSH-008] 서버 등록이 실패하면 활성 상태로 표시하지 않는다', async () => {
    mockRegisterEndpoint.mockRejectedValueOnce(new Error('REGISTER_ENDPOINT_FAILED'));

    await expect(activatePwaFidEndpoint()).rejects.toThrow('REGISTER_ENDPOINT_FAILED');
    expect(getPwaFidEndpointRegistrationState()).toEqual({ status: 'error' });
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
