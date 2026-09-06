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
  const dirty = useRef(new Map<Editable, string>());
  const requested = useRef<ServiceWorker>();

  useEffect(() => {
    if (process.env.NODE_ENV === 'development' || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    let reloaded = false;
    let registration: ServiceWorkerRegistration | undefined;
    let lastCheck = 0;
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
      const worker = registration?.waiting;
      if (!worker) return;
      const channel = new MessageChannel();
      channel.port1.onmessage = event => {
        channel.port1.close();
        if (!cancelled && event.data?.type === 'UPDATE_AVAILABLE' && typeof event.data.workerVersion === 'string') {
          setWaiting({ worker, version: event.data.workerVersion });
        }
      };
      worker.postMessage({ type: 'GET_WORKER_VERSION' }, [channel.port2]);
    };
    const updateFound = () => registration?.installing?.addEventListener('statechange', discoverWaiting);
    const check = () => {
      if (Date.now() - lastCheck < 15 * 60 * 1000) return;
      lastCheck = Date.now();
      void ensurePwaServiceWorker().then(async value => {
        if (cancelled) return;
        if (registration !== value) {
          registration?.removeEventListener('updatefound', updateFound);
          registration = value;
          registration.addEventListener('updatefound', updateFound);
        }
        discoverWaiting();
        await registration.update();
        setFailed(false);
      }).catch(() => { if (!cancelled) setFailed(true); });
    };
    const controllerChanged = () => {
      if (!requested.current || reloaded || navigator.serviceWorker.controller !== requested.current) return;
      reloaded = true;
      reloadPwaWindow();
    };
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
      cancelScheduled();
      registration?.removeEventListener('updatefound', updateFound);
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
    if (!waiting || requested.current) return;
    const hasUnsavedInput = Array.from(dirty.current.keys()).some(element => element.isConnected);
    if (hasUnsavedInput && !await showConfirm({
      title: '작성 중인 입력이 있습니다', message: '저장하려면 취소해 주세요. 입력을 폐기하고 새 버전을 여시겠습니까?',
      confirmLabel: '입력 폐기 후 갱신', cancelLabel: '계속 작성', variant: 'danger',
    })) return;
    requested.current = waiting.worker;
    waiting.worker.postMessage({ type: 'ACTIVATE_WAITING_WORKER', workerVersion: waiting.version });
  };

  if (waiting) return <div role="status" className="fixed bottom-20 left-4 right-4 z-[80] rounded-xl bg-slate-900 p-4 text-sm text-white shadow-lg">
    새 버전이 준비되었습니다. <button type="button" onClick={() => void activate()} className="ml-3 underline">갱신</button>
  </div>;
  if (failed) return <div role="status" className="px-4 py-2 text-sm text-amber-700">앱 업데이트를 확인하지 못했습니다. 연결 후 다시 확인합니다.</div>;
  return null;
}
