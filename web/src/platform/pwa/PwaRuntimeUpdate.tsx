'use client';

import { useEffect, useRef, useState } from 'react';
import { useAppDialog } from '@/contexts/AppDialogContext';
import { isAndroidHostAvailable } from '@/platform/android-host/androidHostBridge';
import { scheduleAfterWebFirstLedgerPaint } from '@/platform/performance/webStartupPerformance';
import { ensurePwaServiceWorker, reloadPwaWindow } from './browserServiceWorker';

type Editable = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLElement;
function valueOf(element: Editable): string {
  if (element instanceof HTMLInputElement) return `${element.value}\u0000${element.checked}`;
  if (element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) return element.value;
  return element.textContent ?? '';
}
function editable(target: EventTarget | null): target is Editable {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement
    || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
}

export function PwaRuntimeUpdate() {
  const { showConfirm } = useAppDialog();
  const [waiting, setWaiting] = useState<{ worker: ServiceWorker; version: string }>();
  const [failed, setFailed] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'requesting' | 'ready'>('idle');
  const dirty = useRef(new Map<Editable, string>());
  const requested = useRef<{ worker: ServiceWorker; approved: Map<Editable, string>; dispose: () => void }>();
  const registration = useRef<ServiceWorkerRegistration>();
  const retryCheck = useRef<() => void>();
  const confirming = useRef(false);
  const mounted = useRef(false);
  const reloaded = useRef(false);

  const currentInputs = () => new Map(Array.from(dirty.current.keys())
    .filter(element => element.isConnected).map(element => [element, valueOf(element)]));
  const failedActivation = () => {
    requested.current?.dispose();
    requested.current = undefined;
    setPhase('idle');
    setWaiting(undefined);
    setFailed(true);
  };
  const controllerChanged = () => {
    const request = requested.current;
    if (!request || reloaded.current || navigator.serviceWorker.controller !== request.worker
      || request.worker.state !== 'activated') return;
    if (Array.from(currentInputs()).some(([element, value]) => request.approved.get(element) !== value)) {
      setPhase('ready');
      return;
    }
    reloaded.current = true;
    request.dispose();
    reloadPwaWindow();
  };

  useEffect(() => {
    if (process.env.NODE_ENV === 'development' || !('serviceWorker' in navigator)) return;
    mounted.current = true;
    let cancelled = false;
    let lastCheck = 0;
    const watchedWorkers = new Set<ServiceWorker>();
    const baselines = new WeakMap<Editable, string>();
    const remember = (event: Event) => {
      if (editable(event.target) && !baselines.has(event.target)) baselines.set(event.target, valueOf(event.target));
    };
    const changed = (event: Event) => {
      if (!editable(event.target)) return;
      const original = baselines.get(event.target);
      // A programmatically dispatched change without focus is conservatively dirty.
      if (original === undefined || original !== valueOf(event.target)) dirty.current.set(event.target, original ?? '');
      else dirty.current.delete(event.target);
    };
    const discoverWaiting = () => {
      const worker = registration.current?.waiting;
      if (!worker) return;
      const channel = new MessageChannel();
      channel.port1.onmessage = event => {
        channel.port1.close();
        if (!cancelled && registration.current?.waiting === worker && worker.state === 'installed'
          && event.data?.type === 'UPDATE_AVAILABLE' && typeof event.data.workerVersion === 'string') {
          setWaiting({ worker, version: event.data.workerVersion });
        }
      };
      worker.postMessage({ type: 'GET_WORKER_VERSION' }, [channel.port2]);
    };
    const updateFound = () => {
      const worker = registration.current?.installing;
      if (worker && !watchedWorkers.has(worker)) {
        watchedWorkers.add(worker);
        worker.addEventListener('statechange', discoverWaiting);
      }
    };
    const check = () => {
      if (Date.now() - lastCheck < 15 * 60 * 1000) return;
      lastCheck = Date.now();
      setFailed(false);
      void ensurePwaServiceWorker().then(async value => {
        if (cancelled) return;
        if (registration.current !== value) {
          registration.current?.removeEventListener('updatefound', updateFound);
          registration.current = value;
          value.addEventListener('updatefound', updateFound);
        }
        discoverWaiting();
        await value.update();
      }).catch(() => { if (!cancelled) setFailed(true); });
    };
    retryCheck.current = () => { lastCheck = 0; check(); };
    const cancelScheduled = scheduleAfterWebFirstLedgerPaint(() => {
      if (cancelled) return;
      if (isAndroidHostAvailable()) {
        void navigator.serviceWorker.getRegistrations().then(registrations => Promise.all(
          registrations.filter(value => [value.active, value.waiting, value.installing].some(worker =>
            worker && ['/sw.js', '/firebase-messaging-sw.js'].includes(new URL(worker.scriptURL).pathname)))
            .map(value => value.unregister())
        )).catch(() => {});
        return;
      }
      window.addEventListener('focus', check);
      window.addEventListener('pageshow', check);
      navigator.serviceWorker.addEventListener('controllerchange', controllerChanged);
      check();
    }, { delayAfterPaintMs: isAndroidHostAvailable() ? 2000 : 10000, idleTimeoutMs: 10000 });
    // Observe from mount, including edits before the delayed worker check.
    document.addEventListener('focusin', remember, true);
    document.addEventListener('beforeinput', remember, true);
    document.addEventListener('input', changed, true);
    document.addEventListener('change', changed, true);
    return () => {
      cancelled = true;
      mounted.current = false;
      cancelScheduled();
      requested.current?.dispose();
      registration.current?.removeEventListener('updatefound', updateFound);
      registration.current = undefined;
      retryCheck.current = undefined;
      watchedWorkers.forEach(worker => worker.removeEventListener('statechange', discoverWaiting));
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
      navigator.serviceWorker.removeEventListener('controllerchange', controllerChanged);
      document.removeEventListener('focusin', remember, true);
      document.removeEventListener('beforeinput', remember, true);
      document.removeEventListener('input', changed, true);
      document.removeEventListener('change', changed, true);
    };
  }, []);

  const activate = async () => {
    if (!waiting || confirming.current || reloaded.current || (requested.current && phase !== 'ready')) return;
    confirming.current = true;
    const previousRequest = requested.current;
    const worker = previousRequest?.worker ?? waiting.worker;
    try {
      if (currentInputs().size && !await showConfirm({
        title: '작성 중인 입력이 있습니다', message: '저장하려면 취소해 주세요. 입력을 폐기하고 새 버전을 여시겠습니까?',
        confirmLabel: '입력 폐기 후 갱신', cancelLabel: '계속 작성', variant: 'danger',
      })) return;
      if (!mounted.current) return;
      if (previousRequest) {
        if (requested.current !== previousRequest || navigator.serviceWorker.controller !== worker
          || worker.state !== 'activated') { failedActivation(); return; }
        previousRequest.approved = currentInputs();
        controllerChanged();
        return;
      }
      if (registration.current?.waiting !== worker && navigator.serviceWorker.controller !== worker) {
        failedActivation();
        return;
      }
      const stateChanged = () => {
        if (worker.state === 'redundant') failedActivation();
        else controllerChanged();
      };
      requested.current = { worker, approved: currentInputs(),
        dispose: () => worker.removeEventListener('statechange', stateChanged) };
      worker.addEventListener('statechange', stateChanged);
      setPhase('requesting');
      worker.postMessage({ type: 'ACTIVATE_WAITING_WORKER', workerVersion: waiting.version });
      stateChanged();
    } catch { if (mounted.current) failedActivation(); }
    finally { confirming.current = false; }
  };

  if (waiting) return <div role="status" className="fixed bottom-20 left-4 right-4 z-[80] rounded-xl bg-slate-900 p-4 text-sm text-white shadow-lg">
    {phase === 'ready' ? '새 버전을 적용할 수 있습니다.' : '새 버전이 준비되었습니다.'}
    <button type="button" onClick={() => void activate()} disabled={phase === 'requesting'} className="ml-3 underline disabled:no-underline">
      {phase === 'requesting' ? '갱신 중…' : phase === 'ready' ? '적용' : '갱신'}
    </button>
  </div>;
  if (failed) return <div role="status" className="px-4 py-2 text-sm text-amber-700">
    앱 업데이트를 확인하지 못했습니다. <button type="button" onClick={() => retryCheck.current?.()} className="underline">다시 확인</button>
  </div>;
  return null;
}
