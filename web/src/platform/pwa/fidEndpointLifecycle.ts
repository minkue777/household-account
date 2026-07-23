import {
  getMessaging,
  isSupported as isMessagingSupported,
  onMessage,
  onRegistered,
  onUnregistered,
  register,
  unregister,
  type MessagePayload,
  type Messaging,
  type Unsubscribe,
} from 'firebase/messaging';
import { app } from '@/lib/firebaseApp';
import { notificationCommands } from '@/features/notifications/application/notificationCommands';
import {
  getClientSessionScope,
  requireClientSessionScope,
} from '@/composition/clientSessionScope';
import { Platform } from '@/lib/utils/platform';

const VAPID_KEY = 'BLI2AoMlLXi5yMOfCAPdup52iEoPoItcWzFQws-Vb5xviQ9VA1ex7oTLZ9M5kqDccQoYAiMaNSUQZSjURD98y3k';
const FIREBASE_MESSAGING_SCOPE = '/firebase-cloud-messaging-push-scope';

interface ActiveEndpointBinding {
  fid: string;
  householdId: string;
  sessionGeneration: number;
  registrationVersion: number;
}

export type PwaFidEndpointRegistrationState =
  | { status: 'idle' }
  | { status: 'unsupported' }
  | { status: 'permission-required' }
  | { status: 'permission-denied' }
  | { status: 'registering' }
  | { status: 'active'; registrationVersion: number }
  | { status: 'error' };

type EndpointStateListener = (state: PwaFidEndpointRegistrationState) => void;

let messagingPromise: Promise<Messaging | null> | undefined;
let lifecycleMessaging: Messaging | undefined;
let unsubscribeRegistered: Unsubscribe | undefined;
let unsubscribeUnregistered: Unsubscribe | undefined;
let unsubscribeForegroundDisplay: Unsubscribe | undefined;
let activeBinding: ActiveEndpointBinding | undefined;
let registrationTask: Promise<void> | undefined;
let activationTask: { sessionGeneration: number; promise: Promise<boolean> } | undefined;
let endpointState: PwaFidEndpointRegistrationState = { status: 'idle' };
const endpointStateListeners = new Set<EndpointStateListener>();

function publishEndpointState(state: PwaFidEndpointRegistrationState): void {
  endpointState = state;
  endpointStateListeners.forEach((listener) => listener(state));
}

function eligibleRuntime(): boolean {
  return Platform.isIOSPWA() && Platform.supportsPushNotification();
}

async function messagingInstance(): Promise<Messaging | null> {
  if (!eligibleRuntime()) return null;
  messagingPromise ??= isMessagingSupported()
    .then((supported) => supported ? getMessaging(app) : null)
    .catch(() => null);
  return messagingPromise;
}

async function messagingServiceWorker(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
    scope: FIREBASE_MESSAGING_SCOPE,
  });
  const registration = await navigator.serviceWorker.getRegistration(FIREBASE_MESSAGING_SCOPE);
  if (!registration) throw new Error('Firebase Messaging 서비스 워커를 찾을 수 없습니다.');
  return registration;
}

const EXPENSE_ID_PATTERN = /^[A-Za-z0-9._-]{1,256}$/;

function foregroundExpensePayload(payload: MessagePayload) {
  const data = payload.data;
  if (
    data?.payloadVersion !== 'notification-payload.v1' ||
    data.clickTarget !== 'expense-edit' ||
    (data.type !== 'expense-created' && data.type !== 'household-notification-requested') ||
    !EXPENSE_ID_PATTERN.test(data.expenseId ?? '')
  ) {
    return null;
  }
  return {
    payloadVersion: 'notification-payload.v1',
    type: data.type,
    clickTarget: 'expense-edit',
    expenseId: data.expenseId,
  };
}

async function displayForegroundExpenseNotification(payload: MessagePayload): Promise<void> {
  const data = foregroundExpensePayload(payload);
  if (!data) return;
  const registration = await messagingServiceWorker();
  await registration.showNotification(
    payload.notification?.title || '가계부 알림',
    {
      body: payload.notification?.body || '새 지출 내역을 확인해 주세요.',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      data,
    }
  );
}

function attachLifecycleListeners(messaging: Messaging): void {
  if (lifecycleMessaging === messaging) return;
  unsubscribeRegistered?.();
  unsubscribeUnregistered?.();
  unsubscribeForegroundDisplay?.();
  lifecycleMessaging = messaging;

  unsubscribeRegistered = onRegistered(messaging, (fid) => {
    const scope = getClientSessionScope();
    if (!scope) return;
    const capturedGeneration = scope.sessionGeneration;
    const task = notificationCommands
      .registerEndpoint(scope.householdId, fid, 'ios-pwa')
      .then((result) => {
        const currentScope = getClientSessionScope();
        if (
          !currentScope ||
          currentScope.sessionGeneration !== capturedGeneration ||
          currentScope.householdId !== scope.householdId
        ) {
          return;
        }
        activeBinding = {
          fid,
          householdId: scope.householdId,
          sessionGeneration: capturedGeneration,
          registrationVersion: result.registrationVersion,
        };
        publishEndpointState({
          status: 'active',
          registrationVersion: result.registrationVersion,
        });
      })
      .catch((error) => {
        const currentScope = getClientSessionScope();
        if (
          currentScope?.sessionGeneration === capturedGeneration &&
          currentScope.householdId === scope.householdId
        ) {
          publishEndpointState({ status: 'error' });
        }
        throw error;
      });
    registrationTask = task;
    void task.catch(() => {});
  });

  unsubscribeUnregistered = onUnregistered(messaging, (fid) => {
    const binding = activeBinding;
    const scope = getClientSessionScope();
    if (
      !binding ||
      binding.fid !== fid ||
      !scope ||
      binding.householdId !== scope.householdId ||
      binding.sessionGeneration !== scope.sessionGeneration
    ) {
      return;
    }
    activeBinding = undefined;
    publishEndpointState({ status: 'idle' });
    const task = notificationCommands.removeEndpointForSdkUnregistered(
      binding.householdId,
      fid,
      binding.registrationVersion
    ).then(() => undefined);
    registrationTask = task;
    void task.catch(() => {});
  });

  unsubscribeForegroundDisplay = onMessage(messaging, (payload) => {
    void displayForegroundExpenseNotification(payload).catch(() => {
      // foreground 표시 실패는 endpoint 등록 상태를 변경하지 않습니다.
    });
  });
}

export async function activatePwaFidEndpoint(): Promise<boolean> {
  if (!eligibleRuntime()) {
    publishEndpointState({ status: 'unsupported' });
    return false;
  }
  if (Notification.permission !== 'granted') {
    publishEndpointState({
      status: Notification.permission === 'denied'
        ? 'permission-denied'
        : 'permission-required',
    });
    return false;
  }

  const scope = requireClientSessionScope();
  if (activationTask?.sessionGeneration === scope.sessionGeneration) {
    return activationTask.promise;
  }

  const promise = (async () => {
    publishEndpointState({ status: 'registering' });
    try {
      const messaging = await messagingInstance();
      if (!messaging) {
        publishEndpointState({ status: 'unsupported' });
        return false;
      }
      attachLifecycleListeners(messaging);
      const serviceWorkerRegistration = await messagingServiceWorker();
      await register(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration,
      });

      const currentRegistrationTask = registrationTask;
      if (!currentRegistrationTask) {
        throw new Error('FID 등록 callback이 실행되지 않았습니다.');
      }
      await currentRegistrationTask;

      const currentScope = getClientSessionScope();
      if (
        !activeBinding ||
        !currentScope ||
        currentScope.sessionGeneration !== scope.sessionGeneration ||
        activeBinding.sessionGeneration !== scope.sessionGeneration ||
        activeBinding.householdId !== scope.householdId
      ) {
        throw new Error('현재 로그인 세션의 알림 endpoint 등록을 확인하지 못했습니다.');
      }
      return true;
    } catch (error) {
      const currentScope = getClientSessionScope();
      if (currentScope?.sessionGeneration === scope.sessionGeneration) {
        publishEndpointState({ status: 'error' });
      }
      throw error;
    }
  })();

  activationTask = { sessionGeneration: scope.sessionGeneration, promise };
  try {
    return await promise;
  } finally {
    if (activationTask?.promise === promise) activationTask = undefined;
  }
}

export async function requestAndActivatePwaFidEndpoint(): Promise<boolean> {
  if (!eligibleRuntime()) {
    publishEndpointState({ status: 'unsupported' });
    return false;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    publishEndpointState({
      status: permission === 'denied' ? 'permission-denied' : 'permission-required',
    });
    return false;
  }
  return activatePwaFidEndpoint();
}

export async function removePwaFidEndpointForLogout(): Promise<void> {
  if (!eligibleRuntime()) return;
  if (registrationTask) await registrationTask.catch(() => undefined);
  const binding = activeBinding;
  if (!binding) {
    publishEndpointState({ status: 'idle' });
    return;
  }

  const scope = requireClientSessionScope();
  if (
    scope.householdId !== binding.householdId ||
    scope.sessionGeneration !== binding.sessionGeneration
  ) {
    throw new Error('알림 endpoint의 세션 범위가 현재 로그인과 일치하지 않습니다.');
  }

  await notificationCommands.removeEndpointForLogout(binding.householdId, binding.fid);
  activeBinding = undefined;
  activationTask = undefined;
  publishEndpointState({ status: 'idle' });
  unsubscribeRegistered?.();
  unsubscribeUnregistered?.();
  unsubscribeForegroundDisplay?.();
  unsubscribeRegistered = undefined;
  unsubscribeUnregistered = undefined;
  unsubscribeForegroundDisplay = undefined;
  lifecycleMessaging = undefined;
  registrationTask = undefined;

  const messaging = await messagingInstance();
  if (messaging) {
    try {
      await unregister(messaging);
    } catch {
      // 서버 binding 삭제가 확인되었으므로 SDK 정리 실패가 로그아웃을 막지는 않습니다.
    }
  }
}

export async function setupPwaForegroundMessageListener(
  onMessageReceived: (payload: MessagePayload) => void
): Promise<Unsubscribe> {
  const messaging = await messagingInstance();
  return messaging ? onMessage(messaging, onMessageReceived) : () => {};
}

export function isPwaPushEligible(): boolean {
  return eligibleRuntime();
}

export function notificationPermission(): NotificationPermission | null {
  if (Platform.isServer() || !Platform.supportsNotification()) return null;
  return Notification.permission;
}

export function getPwaFidEndpointRegistrationState(): PwaFidEndpointRegistrationState {
  return endpointState;
}

export function subscribePwaFidEndpointRegistrationState(
  listener: EndpointStateListener
): Unsubscribe {
  endpointStateListeners.add(listener);
  return () => endpointStateListeners.delete(listener);
}
