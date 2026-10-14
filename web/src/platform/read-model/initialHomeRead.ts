import { getClientSessionScope, type ClientSessionScope } from '@/composition/clientSessionScope';
import { isClientStartupInProgress, recordClientStartupTiming } from '@/platform/performance/clientStartupDiagnostics';
import { Platform } from '@/lib/utils/platform';
import { isAndroidHostAvailable } from '@/platform/android-host/androidHostBridge';

type Source = 'ledger' | 'categories' | 'currencyPreferences' | 'currencyBalances';
const attempted = new Set<Source>();

/** Publish the server read before starting the watch, so an older watch cannot undo it. */
export function subscribeWithInitialHomeRead<T>(options: {
  source: Source;
  scope: Readonly<ClientSessionScope> | undefined;
  read: () => Promise<T>;
  publish: (value: T) => void;
  listen: () => () => void;
}): () => void {
  const { source, scope } = options;
  const isAndroid = isAndroidHostAvailable();
  if (!scope || (!Platform.isIOSPWA() && !isAndroid) || !isClientStartupInProgress() || window.location.pathname !== '/' || attempted.has(source)) {
    return options.listen();
  }
  attempted.add(source);
  let active = true;
  let unsubscribe: (() => void) | undefined;
  const current = () => active && getClientSessionScope() === scope;
  const startLive = () => {
    if (current()) unsubscribe = options.listen();
  };
  const fallback = () => {
    if (!current()) return;
    recordClientStartupTiming(`${source}InitialReadFallback`);
    startLive();
  };
  recordClientStartupTiming(`${source}InitialReadStarted`);
  // The SDK cannot abort this read. Cancellation permanently ignores its result.
  void Promise.resolve().then(() => current() ? options.read() : undefined).then(value => {
    if (!current() || value === undefined) return;
    recordClientStartupTiming(`${source}InitialReadCompleted`);
    try {
      recordClientStartupTiming(`${source}InitialReadReceived`);
      options.publish(value);
    } catch {
      fallback();
      return;
    }
    startLive();
  }, () => {
    if (!current()) return;
    recordClientStartupTiming(`${source}InitialReadFailed`);
    fallback();
  });
  return () => {
    active = false;
    unsubscribe?.();
  };
}
