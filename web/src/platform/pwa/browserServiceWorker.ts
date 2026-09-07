const WORKER_PATH = '/sw.js';
const LEGACY_WORKER_PATH = '/firebase-messaging-sw.js';
const WORKER_HANDSHAKE_TIMEOUT_MS = 3000;
const INITIAL_WORKER_ACTIVATION_TIMEOUT_MS = 15000;
let registrationTask: Promise<ServiceWorkerRegistration> | undefined;

export function reloadPwaWindow(): void { window.location.reload(); }

/** Cache와 Messaging은 같은 root registration을 재사용합니다. */
export function ensurePwaServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (process.env.NODE_ENV === 'development') return Promise.reject(new Error('PWA_DISABLED_IN_DEVELOPMENT'));
  if (!('serviceWorker' in navigator)) return Promise.reject(new Error('PWA_UNSUPPORTED'));
  if (!registrationTask) {
    // Update discovery must not remove the worker that still owns an existing
    // push subscription. The endpoint lifecycle retires it after reconnection.
    registrationTask = navigator.serviceWorker.register(WORKER_PATH, { scope: '/' })
      .catch(error => { registrationTask = undefined; throw error; });
  }
  return registrationTask;
}

/** A waiting worker cannot receive pushes until the user activates its update. */
export async function ensurePwaMessagingServiceWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await ensurePwaServiceWorker();
  const discardFailedInstallation = () => {
    if (![registration.active, registration.waiting, registration.installing]
      .some(worker => worker && worker.state !== 'redundant')) registrationTask = undefined;
  };
  // First installation has no prior controller to preserve. Let the browser
  // finish its normal activation, without promoting a waiting update ourselves.
  const startingWorker = registration.active?.state === 'activating' ? registration.active
    : !registration.active && !registration.waiting ? registration.installing : null;
  if (startingWorker) {
    const installing = startingWorker;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        installing.removeEventListener('statechange', changed);
        if (error) reject(error);
        else resolve();
      };
      const changed = () => {
        if (installing.state === 'activated') finish();
        else if (installing.state === 'redundant') finish(new Error('PWA_PUSH_WORKER_NOT_READY'));
      };
      const timeout = setTimeout(() => finish(new Error('PWA_PUSH_WORKER_NOT_READY')), INITIAL_WORKER_ACTIVATION_TIMEOUT_MS);
      installing.addEventListener('statechange', changed);
      changed();
    }).catch(error => { discardFailedInstallation(); throw error; });
  }
  const active = registration.active;
  if (!active || active.state !== 'activated'
    || new URL(registration.scope, location.origin).pathname !== '/'
    || new URL(active.scriptURL, location.origin).pathname !== WORKER_PATH) {
    discardFailedInstallation();
    throw new Error('PWA_PUSH_WORKER_NOT_READY');
  }
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      channel.port1.close();
      channel.port2.close();
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => finish(new Error('PWA_PUSH_WORKER_NOT_READY')), WORKER_HANDSHAKE_TIMEOUT_MS);
    channel.port1.onmessage = event => {
      if (event.data?.type !== 'UPDATE_AVAILABLE'
        || typeof event.data.workerVersion !== 'string' || !event.data.workerVersion
        || registration.active !== active || active.state !== 'activated') {
        finish(new Error('PWA_PUSH_WORKER_NOT_READY'));
        return;
      }
      finish();
    };
    try { active.postMessage({ type: 'GET_WORKER_VERSION' }, [channel.port2]); }
    catch { finish(new Error('PWA_PUSH_WORKER_NOT_READY')); }
  }).catch(error => { discardFailedInstallation(); throw error; });
  return registration;
}

export async function retireLegacyPwaMessagingWorkers(assertCurrent: () => void): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  assertCurrent();
  for (const registration of registrations) {
    const workers = [registration.active, registration.waiting, registration.installing];
    if (!workers.some(worker => worker && new URL(worker.scriptURL, location.origin).pathname === LEGACY_WORKER_PATH)) continue;
    assertCurrent();
    const removed = await registration.unregister();
    assertCurrent();
    if (!removed) throw new Error('LEGACY_WORKER_CLEANUP_FAILED');
  }
}
