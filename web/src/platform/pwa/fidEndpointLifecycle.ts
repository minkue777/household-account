import {
  getMessaging, isSupported as isMessagingSupported, onMessage, onRegistered,
  onUnregistered, register, unregister, type MessagePayload, type Messaging, type Unsubscribe,
} from 'firebase/messaging';
import { getId, getInstallations } from 'firebase/installations';
import { app } from '@/lib/firebaseApp';
import { notificationCommands } from '@/features/notifications/application/notificationCommands';
import { getClientSessionScope, requireClientSessionScope, type ClientSessionScope } from '@/composition/clientSessionScope';
import { Platform } from '@/lib/utils/platform';
import { ensurePwaServiceWorker } from './browserServiceWorker';
import { expenseNotificationData } from './notificationPayload';

const VAPID_KEY = 'BLI2AoMlLXi5yMOfCAPdup52iEoPoItcWzFQws-Vb5xviQ9VA1ex7oTLZ9M5kqDccQoYAiMaNSUQZSjURD98y3k';
const CLEANUP_KEY = 'pwa-endpoint-cleanup.v1';
interface ActiveEndpointBinding { fid: string; scope: ClientSessionScope; registrationVersion: number }
export type PwaFidEndpointRegistrationState =
  | { status: 'idle' | 'unsupported' | 'permission-required' | 'permission-denied' | 'registering' | 'error' }
  | { status: 'active'; registrationVersion: number };
type EndpointStateListener = (state: PwaFidEndpointRegistrationState) => void;

let messagingPromise: Promise<Messaging | null> | undefined;
let listeners: Unsubscribe[] = [];
let activeBinding: ActiveEndpointBinding | undefined;
let registrationTask: Promise<void> | undefined;
let pendingSdkRemoval: ActiveEndpointBinding | undefined;
let activationTask: { scope: ClientSessionScope; promise: Promise<boolean> } | undefined;
let cleanupStarted = false;
let listenerEpoch = 0;
let endpointState: PwaFidEndpointRegistrationState = { status: 'idle' };
const endpointStateListeners = new Set<EndpointStateListener>();

function publishEndpointState(state: PwaFidEndpointRegistrationState): void {
  endpointState = state;
  endpointStateListeners.forEach(listener => listener(state));
}
function eligibleRuntime(): boolean { return Platform.isIOSPWA() && Platform.supportsPushNotification(); }
function sameScope(a: ClientSessionScope | undefined, b: ClientSessionScope): boolean {
  return !!a && a.principalUid === b.principalUid && a.householdId === b.householdId
    && a.memberId === b.memberId && a.sessionGeneration === b.sessionGeneration;
}
function cleanupPending(): boolean {
  return cleanupStarted || localStorage.getItem(CLEANUP_KEY) !== null;
}
function detachListeners(): void {
  listenerEpoch++;
  listeners.forEach(unsubscribe => unsubscribe());
  listeners = [];
}
async function messagingInstance(): Promise<Messaging | null> {
  if (!eligibleRuntime()) return null;
  messagingPromise ??= isMessagingSupported().then(supported => supported ? getMessaging(app) : null).catch(() => null);
  return messagingPromise;
}
async function retrySdkRemoval(): Promise<void> {
  const binding = pendingSdkRemoval;
  if (!binding) return;
  if (!sameScope(getClientSessionScope(), binding.scope)) throw new Error('PWA_ENDPOINT_SCOPE_CHANGED');
  await notificationCommands.removeEndpointForSdkUnregistered(
    binding.scope.householdId, binding.fid, binding.registrationVersion
  );
  if (pendingSdkRemoval === binding) pendingSdkRemoval = undefined;
  if (activeBinding === binding) activeBinding = undefined;
}

function attachLifecycleListeners(messaging: Messaging, scope: ClientSessionScope): void {
  detachListeners();
  const epoch = listenerEpoch;
  const current = () => epoch === listenerEpoch && !cleanupPending() && sameScope(getClientSessionScope(), scope);
  listeners.push(onRegistered(messaging, fid => {
    if (!current()) return;
    const task = notificationCommands.registerEndpoint(scope.householdId, fid, 'ios-pwa')
      .then(result => {
        if (!current()) return;
        activeBinding = { fid, scope, registrationVersion: result.registrationVersion };
        publishEndpointState({ status: 'active', registrationVersion: result.registrationVersion });
      }).catch(error => {
        if (current()) publishEndpointState({ status: 'error' });
        throw error;
      });
    registrationTask = task;
    void task.catch(() => {});
  }));
  listeners.push(onUnregistered(messaging, fid => {
    const binding = activeBinding;
    if (!current() || !binding || binding.fid !== fid || !sameScope(binding.scope, scope)) return;
    pendingSdkRemoval = binding;
    const task = retrySdkRemoval().then(() => publishEndpointState({ status: 'idle' }))
      .catch(error => { if (current()) publishEndpointState({ status: 'error' }); throw error; });
    registrationTask = task;
    void task.catch(() => {});
  }));
  listeners.push(onMessage(messaging, payload => {
    const binding = activeBinding;
    const data = expenseNotificationData(payload.data);
    if (!current() || !data || !binding || !sameScope(binding.scope, scope)) return;
    void ensurePwaServiceWorker().then(registration => {
      // The registration lookup can finish after logout or actor replacement.
      if (!current() || activeBinding !== binding) return;
      return registration.showNotification(payload.notification?.title || '가계부 알림', {
        body: payload.notification?.body || '새 지출 내역을 확인해 주세요.',
        icon: '/icons/icon-192x192.png', badge: '/icons/icon-72x72.png', data,
      });
    }).catch(() => {});
  }));
}

export async function activatePwaFidEndpoint(): Promise<boolean> {
  if (!eligibleRuntime()) { publishEndpointState({ status: 'unsupported' }); return false; }
  if (cleanupPending()) throw new Error('PWA_SESSION_CLEANUP_REQUIRED');
  const scope = { ...requireClientSessionScope() };
  if (scope.accessMode === 'administrator-readonly') return false;
  if (activeBinding && !sameScope(activeBinding.scope, scope)) throw new Error('PWA_SESSION_CLEANUP_REQUIRED');
  if (Notification.permission !== 'granted') {
    publishEndpointState({ status: Notification.permission === 'denied' ? 'permission-denied' : 'permission-required' });
    return false;
  }
  if (activationTask && sameScope(activationTask.scope, scope)) return activationTask.promise;
  const promise = (async () => {
    publishEndpointState({ status: 'registering' });
    try {
      await retrySdkRemoval();
      const messaging = await messagingInstance();
      if (!messaging) { publishEndpointState({ status: 'unsupported' }); return false; }
      if (cleanupPending() || !sameScope(getClientSessionScope(), scope)) throw new Error('PWA_ENDPOINT_SCOPE_CHANGED');
      attachLifecycleListeners(messaging, scope);
      const serviceWorkerRegistration = await ensurePwaServiceWorker();
      if (cleanupPending() || !sameScope(getClientSessionScope(), scope)) throw new Error('PWA_ENDPOINT_SCOPE_CHANGED');
      registrationTask = undefined;
      await register(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration });
      if (!registrationTask) throw new Error('PWA_FID_CALLBACK_MISSING');
      await registrationTask;
      if (cleanupPending() || !sameScope(getClientSessionScope(), scope)
        || !activeBinding || !sameScope(activeBinding.scope, scope)) throw new Error('PWA_ENDPOINT_SCOPE_CHANGED');
      return true;
    } catch (error) {
      if (sameScope(getClientSessionScope(), scope)) publishEndpointState({ status: 'error' });
      throw error;
    }
  })();
  activationTask = { scope, promise };
  try { return await promise; }
  finally { if (activationTask?.promise === promise) activationTask = undefined; }
}

export async function requestAndActivatePwaFidEndpoint(): Promise<boolean> {
  if (!eligibleRuntime()) { publishEndpointState({ status: 'unsupported' }); return false; }
  requireClientSessionScope();
  if (cleanupPending()) throw new Error('PWA_SESSION_CLEANUP_REQUIRED');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    publishEndpointState({ status: permission === 'denied' ? 'permission-denied' : 'permission-required' });
    return false;
  }
  return activatePwaFidEndpoint();
}

export async function removePwaFidEndpointForLogout(): Promise<void> {
  if (!eligibleRuntime()) return;
  const scope = { ...requireClientSessionScope() };
  // Persist before network I/O so a page reload cannot bypass a failed cleanup.
  localStorage.setItem(CLEANUP_KEY, 'pending');
  cleanupStarted = true;
  detachListeners();
  await activationTask?.promise.catch(() => undefined);
  await registrationTask?.catch(() => undefined);
  if (!sameScope(getClientSessionScope(), scope)) throw new Error('PWA_ENDPOINT_SCOPE_CHANGED');
  const fid = activeBinding?.fid ?? await getId(getInstallations(app));
  await notificationCommands.removeEndpointForLogout(scope.householdId, fid);
  activeBinding = undefined;
  pendingSdkRemoval = undefined;
  registrationTask = undefined;
  publishEndpointState({ status: 'idle' });
  const messaging = await messagingInstance();
  if (messaging) {
    try { await unregister(messaging); } catch { /* Remote deletion already succeeded. */ }
  }
  // The caller releases the barrier only after session/cache purge also succeeds.
}

export function completePwaSessionCleanup(): void {
  localStorage.removeItem(CLEANUP_KEY);
  cleanupStarted = false;
}

export async function setupPwaForegroundMessageListener(
  onMessageReceived: (payload: MessagePayload) => void
): Promise<Unsubscribe> {
  const scope = getClientSessionScope();
  if (!scope || cleanupPending()) return () => {};
  const messaging = await messagingInstance();
  return messaging ? onMessage(messaging, payload => {
    if (!cleanupPending() && sameScope(getClientSessionScope(), scope) && expenseNotificationData(payload.data)) onMessageReceived(payload);
  }) : () => {};
}
export function isPwaPushEligible(): boolean { return eligibleRuntime(); }
export function notificationPermission(): NotificationPermission | null {
  return Platform.isServer() || !Platform.supportsNotification() ? null : Notification.permission;
}
export function getPwaFidEndpointRegistrationState(): PwaFidEndpointRegistrationState { return endpointState; }
export function subscribePwaFidEndpointRegistrationState(listener: EndpointStateListener): Unsubscribe {
  endpointStateListeners.add(listener);
  return () => endpointStateListeners.delete(listener);
}
