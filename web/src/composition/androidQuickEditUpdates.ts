import { getClientSessionScope, type ClientSessionScope } from './clientSessionScope';
import { ledgerOptimisticProjection } from '@/features/ledger/application/ledgerOptimisticProjection';
import { QuickEditLedgerFeedback } from '@/features/ledger/application/quickEditLedgerFeedback';
import { isAndroidHostAvailable, requestAndroidHost } from '@/platform/android-host/androidHostBridge';
import { ANDROID_NATIVE_RESUME_EVENT } from '@/platform/android-host/androidLifecycleEvents';
import { QUICK_EDIT_UPDATES_CHANGED_EVENT, readQuickEditUpdateFeedback } from '@/platform/android-host/quickEditUpdateFeedback';

/** No polling or new server command: read local feedback on connection, resume and changes. */
export function startAndroidQuickEditUpdates(scope: ClientSessionScope): () => void {
  if (!isAndroidHostAvailable() || scope.accessMode === 'administrator-readonly') return () => {};
  let stopped = false;
  let inFlight = false;
  let dirty = false;
  let acknowledging = false;
  const identity = { principalUid: scope.principalUid, householdId: scope.householdId, memberId: scope.memberId };
  const active = () => !stopped && getClientSessionScope() === scope;
  const projection = new QuickEditLedgerFeedback(ledgerOptimisticProjection, scope.householdId,
    (commandIds, nativeSessionGeneration) => {
      if (!active() || acknowledging) return;
      acknowledging = true;
      void requestAndroidHost('quick-edit.ack-update-feedback', {
        ...identity, nativeSessionGeneration, commandIds,
      }).catch(() => {
        // Native retains the completion until a later successful scoped acknowledgement.
      }).finally(() => { acknowledging = false; });
    }, active);

  const refresh = async () => {
    if (!active()) return;
    if (inFlight) { dirty = true; return; }
    inFlight = true;
    try {
      do {
        dirty = false;
        const raw = await requestAndroidHost('quick-edit.get-update-feedback', identity);
        if (!active()) return;
        const snapshot = readQuickEditUpdateFeedback(raw, identity);
        if (snapshot) projection.receive(snapshot);
      } while (dirty && active());
    } catch {
      // Older APKs reject the new operation. Their existing server subscription remains valid.
      // A transient bridge failure keeps pending overlays until the next resume/change.
    } finally {
      inFlight = false;
      if (dirty && active()) void refresh();
    }
  };
  const onChange = () => { void refresh(); };
  const onVisible = () => { if (document.visibilityState === 'visible') onChange(); };
  window.addEventListener(QUICK_EDIT_UPDATES_CHANGED_EVENT, onChange);
  window.addEventListener(ANDROID_NATIVE_RESUME_EVENT, onChange);
  document.addEventListener('visibilitychange', onVisible);
  onChange();
  return () => {
    stopped = true;
    window.removeEventListener(QUICK_EDIT_UPDATES_CHANGED_EVENT, onChange);
    window.removeEventListener(ANDROID_NATIVE_RESUME_EVENT, onChange);
    document.removeEventListener('visibilitychange', onVisible);
    projection.dispose();
  };
}
