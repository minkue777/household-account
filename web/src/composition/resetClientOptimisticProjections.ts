import { resetLoadedClientSessionState } from '@/composition/clientSessionResetRegistry';

/** Discards every session-owned optimistic overlay before auth scope changes. */
export function resetClientOptimisticProjections(): void {
  resetLoadedClientSessionState();
}
