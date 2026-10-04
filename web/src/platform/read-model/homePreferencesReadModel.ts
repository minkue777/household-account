import { getClientSessionScope } from '@/composition/clientSessionScope';
import { db, doc, onSnapshot, type DocumentData } from './firestoreReadModel';
import { subscribeWithInitialHomeRead } from './initialHomeRead';
import { recordClientStartupTiming } from '@/platform/performance/clientStartupDiagnostics';

type Observer = { next: (data: DocumentData | undefined) => void; error?: (error: unknown) => void };
type Entry = {
  scope: ReturnType<typeof getClientSessionScope>;
  observers: Set<Observer>;
  stop: () => void;
  loaded: boolean;
  data?: DocumentData;
};
const entries = new Map<string, Entry>();

/** Card configuration and currency selection share one ordered read/watch. */
export function subscribeToHomePreferencesDocument(
  householdId: string,
  next: Observer['next'],
  error?: Observer['error'],
): () => void {
  const scope = getClientSessionScope();
  const observer = { next, error };
  let entry = entries.get(householdId);
  if (entry && entry.scope !== scope) {
    entry.stop();
    entries.delete(householdId);
    entry = undefined;
  }
  if (entry) {
    entry.observers.add(observer);
    if (entry.loaded) next(entry.data);
  } else {
    const created: Entry = { scope, observers: new Set([observer]), stop: () => {}, loaded: false };
    entries.set(householdId, created);
    entry = created;
    const current = () => entries.get(householdId) === created && getClientSessionScope() === scope;
    const publish = (data: DocumentData | undefined) => {
      if (!current()) return;
      created.data = data;
      created.loaded = true;
      created.observers.forEach(value => value.next(data));
    };
    created.stop = subscribeWithInitialHomeRead({
      source: 'currencyPreferences', scope: scope?.householdId === householdId ? scope : undefined,
      read: async () => {
        const server = await import('./firestoreServerReadModel');
        return server.getDocFromServer(server.doc(server.db, 'households', householdId, 'homePreferences', 'home'));
      },
      publish: snapshot => publish(snapshot.data()),
      listen: () => {
        recordClientStartupTiming('currencyPreferencesListenStarted');
        return onSnapshot(doc(db, 'households', householdId, 'homePreferences', 'home'),
          { includeMetadataChanges: true }, snapshot => {
            if (!current() || snapshot.metadata.fromCache) return;
            recordClientStartupTiming('currencyPreferencesServerSnapshotReceived');
            publish(snapshot.data());
          }, failure => {
            if (current()) created.observers.forEach(value => value.error?.(failure));
          });
      },
    });
  }
  const owned = entry;
  return () => {
    owned.observers.delete(observer);
    if (owned.observers.size === 0) {
      owned.stop();
      if (entries.get(householdId) === owned) entries.delete(householdId);
    }
  };
}
