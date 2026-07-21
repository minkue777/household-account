import type { ShortcutPaymentRecordingInputPort } from "./ports/in/shortcutPaymentRecordingInputPort";
import type {
  ShortcutDefaultCategoryPort,
  ShortcutOwnedCardResolutionPort,
  ShortcutPaymentCommitPort,
} from "./ports/out/shortcutPaymentRecordingPorts";
import type {
  ShortcutPaymentRecordingCommand,
  ShortcutPaymentRecordingResult,
  ShortcutTransactionDraft,
} from "../domain/model/shortcutPaymentRecording";
import { characterizeLegacyShortcutCardType } from "../domain/policies/characterizeLegacyShortcutCardType";

export interface ShortcutPaymentRecordingDependencies {
  readonly defaultCategories: ShortcutDefaultCategoryPort;
  readonly cards: ShortcutOwnedCardResolutionPort;
  readonly commits: ShortcutPaymentCommitPort;
}

class DefaultShortcutPaymentRecordingApplication
  implements ShortcutPaymentRecordingInputPort
{
  constructor(
    private readonly dependencies: ShortcutPaymentRecordingDependencies,
  ) {}

  async record(
    command: ShortcutPaymentRecordingCommand,
  ): Promise<ShortcutPaymentRecordingResult> {
    const category = await this.dependencies.defaultCategories.findForHousehold(
      command.actor.householdId,
    );
    if (category.kind === "Unavailable") {
      return {
        kind: "RetryableFailure",
        code: "REFERENCE_DATA_UNAVAILABLE",
      };
    }
    if (category.kind === "Missing" || category.categoryId.trim() === "") {
      return {
        kind: "Rejected",
        code: "DEFAULT_CATEGORY_UNAVAILABLE",
      };
    }

    const card = await this.dependencies.cards.resolve({
      actor: command.actor,
      evidence: command.parsed.cardEvidence,
    });
    if (card.kind === "Unavailable") {
      return {
        kind: "RetryableFailure",
        code: "REFERENCE_DATA_UNAVAILABLE",
      };
    }
    if (card.kind === "Unmatched") {
      return { kind: "Rejected", code: card.code };
    }

    const transaction: ShortcutTransactionDraft = {
      householdId: command.actor.householdId,
      creatorMemberId: command.actor.memberId,
      transactionType: "expense",
      categoryId: category.categoryId,
      memo: "",
      source: "ios-shortcut",
      amountInWon: command.parsed.amountInWon,
      merchant: command.parsed.merchant,
      cardEvidence: { ...command.parsed.cardEvidence },
      ...(card.canonicalCardId === undefined
        ? {}
        : { selectedRegisteredCardId: card.canonicalCardId }),
    };
    const committed = await this.dependencies.commits.commit({
      commandId: command.commandId,
      transaction,
      outboxEvent: {
        eventId: `${command.commandId}:transaction-recorded`,
        eventName: "TransactionRecorded.v1",
        recipient: {
          kind: "creator-member",
          memberId: command.actor.memberId,
        },
        endpointCapability: "ios-pwa-push",
      },
    });

    return committed.kind === "Created"
      ? committed
      : {
          kind: "RetryableFailure",
          code: "TRANSACTION_COMMIT_UNAVAILABLE",
        };
  }

  characterizeLegacyCardType = characterizeLegacyShortcutCardType;
}

export function createShortcutPaymentRecordingApplication(
  dependencies: ShortcutPaymentRecordingDependencies,
): ShortcutPaymentRecordingInputPort {
  return new DefaultShortcutPaymentRecordingApplication(dependencies);
}
