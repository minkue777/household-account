import { getClientSessionScope, type ClientSessionScope } from '@/composition/clientSessionScope';
import { isClientStartupInProgress, recordClientStartupTiming } from '@/platform/performance/clientStartupDiagnostics';
import { Platform } from '@/lib/utils/platform';

type Source = 'ledger' | 'categories' | 'currencyPreferences' | 'currencyBalances';
export const INITIAL_HOME_READ_BUDGET_MS = 750;
const attempted = new Set<Source>();

/** A bounded server read precedes the watch, so an older watch cannot undo it. */
export function subscribeWithInitialHomeRead<T>(options: {
  source: Source;
  scope: Readonly<ClientSessionScope> | undefined;
  read: () => Promise<T>;
  publish: (value: T) => void;
  listen: () => () => void;
}): () => void {
  const { source, scope } = options;
  if (!scope || !Platform.isIOSPWA() || !isClientStartupInProgress() || window.location.pathname !== '/' || attempted.has(source)) {
    return options.listen();
  }
  attempted.add(source);
  let active = true;
  let decided = false;
  let unsubscribe: (() => void) | undefined;
  const current = () => active && getClientSessionScope() === scope;
  const startLive = () => {
    if (current()) unsubscribe = options.listen();
  };
  const fallback = () => {
    if (decided || !current()) return;
    decided = true;
    clearTimeout(timer);
    recordClientStartupTiming(`${source}InitialReadFallback`);
    startLive();
  };
  const timer = setTimeout(fallback, INITIAL_HOME_READ_BUDGET_MS);
  recordClientStartupTiming(`${source}InitialReadStarted`);
  // The SDK cannot abort this read. Cancellation permanently ignores its result.
  void Promise.resolve().then(() => current() && !decided ? options.read() : undefined).then(value => {
    if (decided || !current() || value === undefined) return;
    try {
      recordClientStartupTiming(`${source}InitialReadReceived`);
      options.publish(value);
    } catch {
      fallback();
      return;
    }
    decided = true;
    clearTimeout(timer);
    startLive();
  }, fallback);
  return () => {
    active = false;
    clearTimeout(timer);
    unsubscribe?.();
  };
}
