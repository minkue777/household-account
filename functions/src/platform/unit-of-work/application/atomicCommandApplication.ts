import { decideAtomicCommand } from "../domain/atomicCommand";
import type { AtomicCommandInputPort } from "./ports/in/atomicCommandInputPort";
import type {
  AtomicCommandUnitOfWork,
  AtomicEventIdGenerator,
  CommittedEventDispatcher,
} from "./ports/out/atomicCommandPorts";

export function createAtomicCommandApplication(dependencies: {
  readonly unitOfWork: AtomicCommandUnitOfWork;
  readonly eventIds: AtomicEventIdGenerator;
  readonly dispatcher: CommittedEventDispatcher;
}): AtomicCommandInputPort {
  return {
    async execute(input) {
      const eventId = dependencies.eventIds.forCommand(input.commandId);
      const outcome = await dependencies.unitOfWork.transact((state) =>
        decideAtomicCommand({ state, eventId, ...input }),
      );
      if (outcome.kind === "retryable-failure") return outcome;
      if (outcome.committedEvent !== undefined) {
        await dependencies.dispatcher.dispatch(outcome.committedEvent);
      }
      return outcome.result;
    },
  };
}
