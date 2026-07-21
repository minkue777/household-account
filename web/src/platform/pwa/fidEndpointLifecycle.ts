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
import { app } from '@/lib/firebase';
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

let messagingPromise: Promise<Messaging | null> | undefined;
let lifecycleMessaging: Messaging | undefined;
let unsubscribeRegistered: Unsubscribe | undefined;
let unsubscribeUnregistered: Unsubscribe | undefined;
let activeBinding: ActiveEndpointBinding | undefined;
let registrationTask: Promise<void> | undefined;

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

function attachLifecycleListeners(messaging: Messaging): void {
  if (lifecycleMessaging === messaging) return;
  unsubscribeRegistered?.();
  unsubscribeUnregistered?.();
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
    const task = notificationCommands.removeEndpointForSdkUnregistered(
      binding.householdId,
      fid,
      binding.registrationVersion
    ).then(() => undefined);
    registrationTask = task;
    void task.catch(() => {});
  });
}

export async function activatePwaFidEndpoint(): Promise<boolean> {
  if (!eligibleRuntime() || Notification.permission !== 'granted') return false;
  requireClientSessionScope();
  const messaging = await messagingInstance();
  if (!messaging) return false;
  attachLifecycleListeners(messaging);
  const serviceWorkerRegistration = await messagingServiceWorker();
  await register(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration,
  });
  return true;
}

export async function requestAndActivatePwaFidEndpoint(): Promise<boolean> {
  if (!eligibleRuntime()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  return activatePwaFidEndpoint();
}

export async function removePwaFidEndpointForLogout(): Promise<void> {
  if (!eligibleRuntime()) return;
  if (registrationTask) await registrationTask;
  const binding = activeBinding;
  if (!binding) return;

  const scope = requireClientSessionScope();
  if (
    scope.householdId !== binding.householdId ||
    scope.sessionGeneration !== binding.sessionGeneration
  ) {
    throw new Error('알림 endpoint의 세션 범위가 현재 로그인과 일치하지 않습니다.');
  }

  await notificationCommands.removeEndpointForLogout(binding.householdId, binding.fid);
  activeBinding = undefined;
  unsubscribeRegistered?.();
  unsubscribeUnregistered?.();
  unsubscribeRegistered = undefined;
  unsubscribeUnregistered = undefined;
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
