import type { BrowserContext, Worker, JSHandle } from '@playwright/test';

type Probe = { read(): { events: Array<Record<string, unknown>>; pending: Array<Record<string, unknown>> }; dispose(): void };

// Observe native promises; do not synthesize messages, resolve them or replace workers.
export function observeWorkerActivation(context: BrowserContext) {
  const probes = new Map<Worker, Promise<JSHandle<Probe> | undefined>>();
  const observe = (worker: Worker) => {
    if (probes.has(worker)) return;
    probes.set(worker, worker.evaluateHandle(() => {
      const scope = self as unknown as { skipWaiting(): Promise<void>; ExtendableEvent: { prototype: { waitUntil(promise: Promise<unknown>): void } } };
      const events: Array<Record<string, unknown>> = [];
      const pending = new Map<number, Record<string, unknown>>();
      const record = (event: Record<string, unknown>) => { events.push({ ...event, atMs: performance.now() }); if (events.length > 50) events.shift(); };
      const message = (event: MessageEvent) => record({ type: 'message', messageType: event.data?.type, workerVersion: event.data?.workerVersion });
      self.addEventListener('message', message);
      const originalSkipWaiting = scope.skipWaiting;
      scope.skipWaiting = function () {
        record({ type: 'skipWaiting' });
        const result = originalSkipWaiting.call(this);
        void result.then(() => record({ type: 'skipWaiting-resolved' }), () => record({ type: 'skipWaiting-rejected' }));
        return result;
      };
      const prototype = scope.ExtendableEvent.prototype;
      const originalWaitUntil = prototype.waitUntil;
      let sequence = 0;
      prototype.waitUntil = function (this: { type?: string; request?: Request; data?: { type?: string } }, promise) {
        originalWaitUntil.call(this, promise);
        const id = ++sequence;
        pending.set(id, { eventType: this.type, url: this.request?.url, messageType: this.data?.type, startedAtMs: performance.now() });
        void Promise.resolve(promise).then(() => pending.delete(id), () => pending.delete(id));
      };
      return {
        read: () => ({ events, pending: Array.from(pending.values()) }),
        dispose: () => { self.removeEventListener('message', message); scope.skipWaiting = originalSkipWaiting; prototype.waitUntil = originalWaitUntil; },
      };
    }).catch(() => undefined));
  };
  context.on('serviceworker', observe);
  context.serviceWorkers().forEach(observe);
  return {
    ready: () => Promise.all(probes.values()),
    read: () => Promise.all(Array.from(probes).map(async ([worker, handle]) => {
      const probe = await handle;
      return { url: worker.url(), ...(probe ? await probe.evaluate(value => value.read()).catch(() => ({ unavailable: true })) : { unavailable: true }) };
    })),
    dispose: async () => {
      context.off('serviceworker', observe);
      for (const handle of Array.from(probes.values())) {
        const probe = await handle;
        if (probe) { await probe.evaluate(value => value.dispose()).catch(() => {}); await probe.dispose(); }
      }
    },
  };
}
