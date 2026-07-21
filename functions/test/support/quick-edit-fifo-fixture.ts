import { createQuickEditFifoApplication } from "../reference/android-host/application/quickEditFifoApplication";
import type {
  PersistedQuickEditQueueEntry,
  QuickEditPresentationCheck,
  QuickEditSessionScope,
} from "../reference/android-host/application/ports/in/quickEditFifoInputPort";

export function createQuickEditFifoFixture(options?: {
  readonly session?: QuickEditSessionScope;
  readonly restoredEntries?: readonly PersistedQuickEditQueueEntry[];
  readonly presentationChecks?: Readonly<
    Record<string, QuickEditPresentationCheck>
  >;
}) {
  return createQuickEditFifoApplication({
    session: options?.session ?? {
      sessionGeneration: "session-default",
      householdId: "household-1",
      memberId: "member-1",
    },
    restoredEntries: options?.restoredEntries,
    presentationChecks: options?.presentationChecks,
  });
}
