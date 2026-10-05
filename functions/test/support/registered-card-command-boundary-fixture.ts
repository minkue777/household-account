import { registerCardMutation, updateCardMutation, retireCardMutation, reorderCardsMutation, cardState, type CardMutation } from "../../src/contexts/payment-capture/configuration/application/registeredCardMutation";
import type { RegisteredCardCommandRecord, RegisteredCardCommandBoundaryInputPort as Commands, RegisteredCardCommandResult } from "../../src/contexts/payment-capture/configuration/application/ports/in/registeredCardCommandBoundaryInputPort";

type Commit = { commitOutcome?: "success" | "failure" };

export function createRegisteredCardCommandBoundaryFixture(fixture?: {
  readonly cards?: readonly RegisteredCardCommandRecord[];
  readonly collectionVersions?: Readonly<Record<string, number>>;
}) {
  const householdId = fixture?.cards?.[0]?.householdId ?? Object.keys(fixture?.collectionVersions ?? {})[0]?.split(":")[0] ?? "household-a";
  let state = cardState(fixture?.cards ?? [], fixture?.collectionVersions);
  const commit = (mutation: CardMutation, outcome?: string): RegisteredCardCommandResult => {
    if (mutation.writes) {
      if (outcome === "failure") return { kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" };
      state = mutation.state;
    }
    return mutation.value;
  };
  return {
    register(input: Parameters<Commands["register"]>[0]) { return commit(registerCardMutation(state, householdId, input)); },
    updateLastFour(input: Parameters<Commands["updateLastFour"]>[0] & Commit) { return commit(updateCardMutation(state, householdId, input), input.commitOutcome); },
    retire(input: Parameters<Commands["retire"]>[0] & Commit) { return commit(retireCardMutation(state, householdId, input), input.commitOutcome); },
    reorder(input: Parameters<Commands["reorder"]>[0] & Commit) { return commit(reorderCardsMutation(state, householdId, input), input.commitOutcome); },
    state: () => structuredClone(state),
  };
}
