type WorkerMock = EventTarget & { state: string; scriptURL: string; postMessage: jest.Mock };

function worker(state = 'activated', respond = true): WorkerMock {
  return Object.assign(new EventTarget(), {
    state,
    scriptURL: `${location.origin}/sw.js`,
    postMessage: jest.fn((_message, ports) => {
      if (respond) ports[0].reply({ type: 'UPDATE_AVAILABLE', workerVersion: 'messaging-v1' });
    }),
  });
}

let root: { scope: string; active: WorkerMock | null; waiting: WorkerMock | null; installing: WorkerMock | null };
const legacyUnregister = jest.fn(async () => true);
const register = jest.fn(async () => root);
const getRegistrations = jest.fn(async () => [{
  scope: `${location.origin}/firebase-cloud-messaging-push-scope`,
  active: { scriptURL: `${location.origin}/firebase-messaging-sw.js` },
  unregister: legacyUnregister,
}]);

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  jest.useFakeTimers();
  root = { scope: `${location.origin}/`, active: worker(), waiting: null, installing: null };
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register, getRegistrations } });
  Object.defineProperty(globalThis, 'MessageChannel', {
    configurable: true,
    value: class {
      port1 = { onmessage: undefined as undefined | ((event: unknown) => void), close: jest.fn() };
      port2 = { reply: (data: unknown) => this.port1.onmessage?.({ data }), close: jest.fn() };
    },
  });
});
afterEach(() => jest.useRealTimers());

it('ordinary update discovery preserves the legacy push registration', async () => {
  const { ensurePwaServiceWorker } = await import('@/platform/pwa/browserServiceWorker');
  await expect(ensurePwaServiceWorker()).resolves.toBe(root);
  expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  expect(getRegistrations).not.toHaveBeenCalled();
  expect(legacyUnregister).not.toHaveBeenCalled();
});

it('waits for a first installing worker to activate naturally and complete its messaging handshake', async () => {
  const first = worker('installing');
  root = { ...root, active: null, installing: first };
  const { ensurePwaMessagingServiceWorker } = await import('@/platform/pwa/browserServiceWorker');
  const pending = ensurePwaMessagingServiceWorker();
  await Promise.resolve();
  expect(first.postMessage).not.toHaveBeenCalled();
  first.state = 'activated';
  root.active = first;
  root.installing = null;
  first.dispatchEvent(new Event('statechange'));
  await expect(pending).resolves.toBe(root);
  expect(first.postMessage).toHaveBeenCalledTimes(1);
  expect(first.postMessage.mock.calls[0][0]).toEqual({ type: 'GET_WORKER_VERSION' });
  expect(legacyUnregister).not.toHaveBeenCalled();
});

it('does not promote a waiting worker when the active root worker has no messaging handshake', async () => {
  root.active = worker('activated', false);
  root.waiting = worker('installed');
  const { ensurePwaMessagingServiceWorker } = await import('@/platform/pwa/browserServiceWorker');
  const pending = expect(ensurePwaMessagingServiceWorker()).rejects.toThrow('PWA_PUSH_WORKER_NOT_READY');
  await jest.advanceTimersByTimeAsync(3000);
  await pending;
  expect(root.waiting.postMessage).not.toHaveBeenCalled();
  expect(legacyUnregister).not.toHaveBeenCalled();
});

it('waits for an already activating first worker instead of failing its initial registration', async () => {
  const first = worker('activating');
  root.active = first;
  const { ensurePwaMessagingServiceWorker } = await import('@/platform/pwa/browserServiceWorker');
  const pending = ensurePwaMessagingServiceWorker();
  await Promise.resolve();
  first.state = 'activated';
  first.dispatchEvent(new Event('statechange'));
  await expect(pending).resolves.toBe(root);
  expect(first.postMessage.mock.calls[0][0]).toEqual({ type: 'GET_WORKER_VERSION' });
});

it('a failed initial installation can register again on the next attempt', async () => {
  const first = worker('installing');
  root = { ...root, active: null, installing: first };
  const { ensurePwaMessagingServiceWorker } = await import('@/platform/pwa/browserServiceWorker');
  const failure = expect(ensurePwaMessagingServiceWorker()).rejects.toThrow('PWA_PUSH_WORKER_NOT_READY');
  await Promise.resolve();
  first.state = 'redundant';
  first.dispatchEvent(new Event('statechange'));
  await failure;
  root = { ...root, active: worker(), installing: null };
  await expect(ensurePwaMessagingServiceWorker()).resolves.toBe(root);
  expect(register).toHaveBeenCalledTimes(2);
});

it('rejects waiting-only registrations and bounds unsuccessful first installation', async () => {
  root.active = null;
  root.waiting = worker('installed');
  const { ensurePwaMessagingServiceWorker } = await import('@/platform/pwa/browserServiceWorker');
  await expect(ensurePwaMessagingServiceWorker()).rejects.toThrow('PWA_PUSH_WORKER_NOT_READY');
  root.waiting = null;
  root.installing = worker('installing');
  const pending = expect(ensurePwaMessagingServiceWorker()).rejects.toThrow('PWA_PUSH_WORKER_NOT_READY');
  await jest.advanceTimersByTimeAsync(15000);
  await pending;
  expect(legacyUnregister).not.toHaveBeenCalled();
});

it('retirement is explicit and checks the caller scope before deleting the old worker', async () => {
  const { retireLegacyPwaMessagingWorkers } = await import('@/platform/pwa/browserServiceWorker');
  await expect(retireLegacyPwaMessagingWorkers(() => { throw new Error('SESSION_CHANGED'); })).rejects.toThrow('SESSION_CHANGED');
  expect(legacyUnregister).not.toHaveBeenCalled();
  await retireLegacyPwaMessagingWorkers(() => {});
  expect(legacyUnregister).toHaveBeenCalledTimes(1);
});
