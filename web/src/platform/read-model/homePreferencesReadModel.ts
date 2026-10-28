import { getClientSessionScope } from '@/composition/clientSessionScope';
import { db, doc, onDocumentSnapshot as onSnapshot, type DocumentData } from './firestoreReadModel';
import { subscribeWithInitialHomeRead } from './initialHomeRead';
import { recordClientStartupTiming } from '@/platform/performance/clientStartupDiagnostics';

type Observer = { next: (data: DocumentData | undefined) => void; error?: (error: unknown) => void };
type Entry = {
  scope: ReturnType<typeof getClientSessionScope>;
  observers: Set<Observer>;
  stop: () => void;
  restart: () => void;
  generation: number;
  failed: boolean;
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
  if (process.env.NEXT_PUBLIC_E2E_TEST_MODE === 'true') console.debug('home-preferences-read', JSON.stringify({
    stage: 'subscribe', sessionGeneration: scope?.sessionGeneration,
  }));
  const observer = { next, error };
  let entry = entries.get(householdId);
  if (entry && entry.scope !== scope) {
    entry.stop();
    entries.delete(householdId);
    entry = undefined;
  }
  if (entry) {
    entry.observers.add(observer);
    if (entry.failed) entry.restart();
    if (entry.loaded) next(entry.data);
  } else {
    const created: Entry = { scope, observers: new Set([observer]), stop: () => {}, restart: () => {},
      generation: 0, failed: false, loaded: false };
    entries.set(householdId, created);
    entry = created;
    created.restart = () => {
      created.stop();
      created.failed = false;
      const generation = ++created.generation;
      const current = () => entries.get(householdId) === created && getClientSessionScope() === scope
        && created.generation === generation;
      const publish = (data: DocumentData | undefined) => {
        if (process.env.NEXT_PUBLIC_E2E_TEST_MODE === 'true') console.debug('home-preferences-read', JSON.stringify({
          stage: 'publish', current: current(), observers: created.observers.size,
          version: Number.isSafeInteger(data?.aggregateVersion) ? data?.aggregateVersion : null,
        }));
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
              if (process.env.NEXT_PUBLIC_E2E_TEST_MODE === 'true') console.debug('home-preferences-read', JSON.stringify({
                stage: 'snapshot', current: current(), scopeCurrent: getClientSessionScope() === scope,
                fromCache: snapshot.metadata.fromCache,
                version: Number.isSafeInteger(snapshot.data()?.aggregateVersion) ? snapshot.data()?.aggregateVersion : null,
              }));
              if (!current() || snapshot.metadata.fromCache) return;
              recordClientStartupTiming('currencyPreferencesServerSnapshotReceived');
              publish(snapshot.data());
            }, failure => {
              if (current()) {
                created.failed = true;
                created.observers.forEach(value => value.error?.(failure));
              }
            });
        },
      });
    };
    created.restart();
  }
  const owned = entry;
  return () => {
    if (process.env.NEXT_PUBLIC_E2E_TEST_MODE === 'true') console.debug('home-preferences-read', JSON.stringify({
      stage: 'unsubscribe', observers: owned.observers.size,
    }));
    owned.observers.delete(observer);
    if (owned.observers.size === 0) {
      owned.stop();
      if (entries.get(householdId) === owned) entries.delete(householdId);
    }
  };
}
