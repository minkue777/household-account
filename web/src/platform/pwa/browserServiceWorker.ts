const WORKER_PATH = '/sw.js';
const LEGACY_WORKER_PATH = '/firebase-messaging-sw.js';
let registrationTask: Promise<ServiceWorkerRegistration> | undefined;

export function reloadPwaWindow(): void { window.location.reload(); }

/** Cache와 Messaging은 같은 root registration을 재사용합니다. */
export function ensurePwaServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (process.env.NODE_ENV === 'development') return Promise.reject(new Error('PWA_DISABLED_IN_DEVELOPMENT'));
  if (!('serviceWorker' in navigator)) return Promise.reject(new Error('PWA_UNSUPPORTED'));
  if (!registrationTask) {
    registrationTask = (async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        const workers = [registration.active, registration.waiting, registration.installing];
        if (workers.some(worker => worker && new URL(worker.scriptURL, location.origin).pathname === LEGACY_WORKER_PATH)) {
          if (!await registration.unregister()) throw new Error('LEGACY_WORKER_CLEANUP_FAILED');
        }
      }
      return navigator.serviceWorker.register(WORKER_PATH, { scope: '/' });
    })().catch(error => { registrationTask = undefined; throw error; });
  }
  return registrationTask;
}
