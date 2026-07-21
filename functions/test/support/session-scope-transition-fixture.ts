import { createSessionScopeTransitionApplication } from "../reference/android-host/application/sessionScopeTransitionApplication";
import type {
  SessionScopeSnapshot,
} from "../reference/android-host/application/ports/in/sessionScopeTransitionInputPort";

export function createSessionScopeTransitionFixture(fixture: {
  readonly current: SessionScopeSnapshot;
  readonly quickEditTransactionIds?: readonly string[];
  readonly captureObservationIds?: readonly string[];
  readonly quickEditPreferences?: Readonly<Record<string, boolean>>;
  readonly legacyQuickEditPreferences?: Readonly<Record<string, boolean>>;
  readonly interruptedTransition?: {
    readonly phase: "queues-purged-before-mirror-commit";
    readonly target: SessionScopeSnapshot;
  };
}) {
  return createSessionScopeTransitionApplication(fixture);
}
