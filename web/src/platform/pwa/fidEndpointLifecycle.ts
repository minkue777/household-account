import {
  getMessaging, isSupported as isMessagingSupported, onMessage, onRegistered,
  onUnregistered, register, unregister, type MessagePayload, type Messaging, type Unsubscribe,
} from 'firebase/messaging';
import { getId, getInstallations } from 'firebase/installations';
import { app } from '@/lib/firebaseApp';
import { notificationCommands } from '@/features/notifications/application/notificationCommands';
import { getClientSessionScope, requireClientSessionScope, type ClientSessionScope } from '@/composition/clientSessionScope';
import { Platform } from '@/lib/utils/platform';
import { ensurePwaServiceWorker, ensurePwaMessagingServiceWorker, retireLegacyPwaMessagingWorkers } from './browserServiceWorker';
import { expenseNotificationData } from './notificationPayload';
import { formatPwaEndpointRegistrationErrorCode, type PwaEndpointRegistrationPhase } from './pwaEndpointRegistrationDiagnostic';

const VAPID_KEY = 'BLI2AoMlLXi5yMOfCAPdup52iEoPoItcWzFQws-Vb5xviQ9VA1ex7oTLZ9M5kqDccQoYAiMaNSUQZSjURD98y3k';
const CLEANUP_KEY = 'pwa-endpoint-cleanup.v1';
const ROOT_BINDING_KEY = 'pwa-fid-root-binding.v1';
interface ActiveEndpointBinding { fid: string; scope: ClientSessionScope; registrationVersion: number }
interface RootBindingMarker { fid: string; subscriptionFingerprint: string }
export type PwaFidEndpointRegistrationState =
  | { status: 'idle' | 'unsupported' | 'permission-required' | 'permission-denied' | 'registering' | 'error'; phase?: PwaEndpointRegistrationPhase; errorCode?: string }
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
// Includes an accepted remote registration whose reply arrived after logout
// invalidated its listener, so cleanup does not lose a newly rotated FID.
const registrationFidsForCleanup = new Set<string>();
const pendingEndpointTasks = new Set<Promise<void>>();

function trackEndpointTask(task: Promise<void>): void {
  registrationTask = task;
  pendingEndpointTasks.add(task);
  const completed = () => { pendingEndpointTasks.delete(task); };
  void task.then(completed, completed);
}

async function drainEndpointTasks(): Promise<void> {
  while (pendingEndpointTasks.size > 0) {
    await Promise.all(Array.from(pendingEndpointTasks, task => task.catch(() => undefined)));
  }
}

function readRootBindingMarker(): RootBindingMarker | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(ROOT_BINDING_KEY) ?? 'null');
    return value && typeof value.fid === 'string' && typeof value.subscriptionFingerprint === 'string'
      ? value : undefined;
  } catch { return undefined; }
}

async function subscriptionFingerprint(registration: ServiceWorkerRegistration): Promise<string | undefined> {
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return undefined;
  const auth = subscription.getKey('auth');
  const p256dh = subscription.getKey('p256dh');
  if (!subscription.endpoint || !auth || !p256dh) throw new Error('PWA_PUSH_SUBSCRIPTION_INVALID');
  const identity = JSON.stringify([
    registration.scope, VAPID_KEY, subscription.endpoint,
    Array.from(new Uint8Array(auth)), Array.from(new Uint8Array(p256dh)),
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

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

function attachLifecycleListeners(messaging: Messaging, scope: ClientSessionScope, onServerRegistration?: () => void): void {
  detachListeners();
  const epoch = listenerEpoch;
  const current = () => epoch === listenerEpoch && !cleanupPending() && sameScope(getClientSessionScope(), scope);
  listeners.push(onRegistered(messaging, fid => {
    if (!current()) return;
    onServerRegistration?.();
    registrationFidsForCleanup.add(fid);
    const task = notificationCommands.registerEndpoint(scope.householdId, fid, 'ios-pwa')
      .then(result => {
        if (!current()) return;
        activeBinding = { fid, scope, registrationVersion: result.registrationVersion };
        // An explicit activation publishes only after subscription verification
        // and legacy cleanup have also completed.
        if (!activationTask) publishEndpointState({ status: 'active', registrationVersion: result.registrationVersion });
      }).catch(error => {
        if (current()) publishEndpointState({ status: 'error', phase: 'server-registration', errorCode: formatPwaEndpointRegistrationErrorCode(error) });
        throw error;
      });
    trackEndpointTask(task);
  }));
  listeners.push(onUnregistered(messaging, fid => {
    const binding = activeBinding;
    if (!current() || !binding || binding.fid !== fid || !sameScope(binding.scope, scope)) return;
    pendingSdkRemoval = binding;
    const task = retrySdkRemoval().then(() => { if (current()) publishEndpointState({ status: 'idle' }); })
      .catch(error => { if (current()) publishEndpointState({ status: 'error', phase: 'unregister', errorCode: formatPwaEndpointRegistrationErrorCode(error) }); throw error; });
    trackEndpointTask(task);
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
  if (activationTask) {
    await activationTask.promise.catch(() => undefined);
    // SDK unregister() has no shared queue with register(); serialize actor
    // replacement too, then take a fresh scope and cleanup-barrier snapshot.
    return activatePwaFidEndpoint();
  }
  const promise = (async () => {
    let phase: PwaEndpointRegistrationPhase = 'worker';
    const setPhase = (next: PwaEndpointRegistrationPhase) => {
      phase = next;
      publishEndpointState({ status: 'registering', phase });
    };
    setPhase('worker');
    let messaging: Messaging | null | undefined;
    const assertScope = () => {
      if (cleanupPending() || !sameScope(getClientSessionScope(), scope)) throw new Error('PWA_ENDPOINT_SCOPE_CHANGED');
    };
    try {
      detachListeners();
      await drainEndpointTasks();
      assertScope();
      if (pendingSdkRemoval) setPhase('unregister');
      await retrySdkRemoval();
      assertScope();
      if (phase !== 'worker') setPhase('worker');
      messaging = await messagingInstance();
      assertScope();
      if (!messaging) { publishEndpointState({ status: 'unsupported' }); return false; }
      const serviceWorkerRegistration = await ensurePwaMessagingServiceWorker();
      assertScope();
      const readyWorker = serviceWorkerRegistration.active;
      const assertCurrent = () => {
        assertScope();
        if (serviceWorkerRegistration.active !== readyWorker || readyWorker?.state !== 'activated') {
          throw new Error('PWA_PUSH_WORKER_NOT_READY');
        }
      };
      setPhase('installation');
      const fid = await getId(getInstallations(app));
      assertCurrent();
      setPhase('subscription');
      const fingerprintBefore = await subscriptionFingerprint(serviceWorkerRegistration);
      assertCurrent();
      const marker = readRootBindingMarker();
      const reconnect = !fingerprintBefore || marker?.fid !== fid
        || marker.subscriptionFingerprint !== fingerprintBefore;

      if (reconnect) {
        // Firebase's seven-day FID cache does not compare SW scope or the push
        // subscription. Use public APIs to refresh it without deleting the FID.
        localStorage.removeItem(ROOT_BINDING_KEY);
        detachListeners();
        let primedFid: string | undefined;
        const stopPrimeListener = onRegistered(messaging, value => { primedFid = value; });
        try {
          // A fresh installation has no FCM registration to DELETE. Prime it
          // first, without publishing an app endpoint or an active UI state.
          setPhase('prime-registration');
          await register(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration });
          assertCurrent();
          if (primedFid !== fid) throw new Error('PWA_FID_CHANGED_DURING_REGISTRATION');
          setPhase('unregister');
          await unregister(messaging);
          assertCurrent();
        } finally {
          stopPrimeListener();
        }
      }

      attachLifecycleListeners(messaging, scope, () => {
        if (activationTask?.promise === promise) setPhase('server-registration');
      });
      registrationTask = undefined;
      setPhase('push-registration');
      await register(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration });
      assertCurrent();
      if (!registrationTask) throw new Error('PWA_FID_CALLBACK_MISSING');
      await registrationTask;
      assertCurrent();
      if (!activeBinding || !sameScope(activeBinding.scope, scope)) throw new Error('PWA_ENDPOINT_SCOPE_CHANGED');
      if (activeBinding.fid !== fid) throw new Error('PWA_FID_CHANGED_DURING_REGISTRATION');
      setPhase('verification');
      const confirmedBinding = activeBinding;
      const assertConfirmed = () => {
        assertCurrent();
        if (activeBinding !== confirmedBinding || pendingSdkRemoval) throw new Error('PWA_ENDPOINT_BINDING_CHANGED');
      };
      const fingerprintAfter = await subscriptionFingerprint(serviceWorkerRegistration);
      assertConfirmed();
      if (!fingerprintAfter || (!reconnect && fingerprintBefore !== fingerprintAfter)) {
        throw new Error('PWA_PUSH_SUBSCRIPTION_CHANGED');
      }
      setPhase('legacy-cleanup');
      await retireLegacyPwaMessagingWorkers(assertConfirmed);
      assertConfirmed();
      localStorage.setItem(ROOT_BINDING_KEY, JSON.stringify({ fid, subscriptionFingerprint: fingerprintAfter }));
      publishEndpointState({ status: 'active', registrationVersion: confirmedBinding.registrationVersion });
      return true;
    } catch (error) {
      // Update readiness can fail while the previous endpoint still receives
      // messages. Restore its foreground handler without bypassing logout.
      if (messaging && !cleanupPending() && sameScope(getClientSessionScope(), scope)
        && activeBinding && sameScope(activeBinding.scope, scope)) attachLifecycleListeners(messaging, scope);
      if (sameScope(getClientSessionScope(), scope)) publishEndpointState({ status: 'error', phase, errorCode: formatPwaEndpointRegistrationErrorCode(error) });
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
  await drainEndpointTasks();
  if (!sameScope(getClientSessionScope(), scope)) throw new Error('PWA_ENDPOINT_SCOPE_CHANGED');
  const currentFid = await getId(getInstallations(app));
  const fids = new Set([...Array.from(registrationFidsForCleanup), currentFid, ...(activeBinding ? [activeBinding.fid] : [])]);
  for (const fid of Array.from(fids)) {
    if (!sameScope(getClientSessionScope(), scope)) throw new Error('PWA_ENDPOINT_SCOPE_CHANGED');
    await notificationCommands.removeEndpointForLogout(scope.householdId, fid);
    if (!sameScope(getClientSessionScope(), scope)) throw new Error('PWA_ENDPOINT_SCOPE_CHANGED');
  }
  registrationFidsForCleanup.clear();
  localStorage.removeItem(ROOT_BINDING_KEY);
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
