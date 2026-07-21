import { createOwnCardResolutionPolicy } from "../../src/contexts/payment-capture/configuration/public";
import { createShortcutPaymentRecordingApplication } from "../../src/contexts/payment-capture/shortcut-ingestion/application/shortcutPaymentRecordingApplication";
import type {
  ShortcutDefaultCategoryPort,
  ShortcutDefaultCategoryResult,
  ShortcutOwnedCardResolutionPort,
  ShortcutPaymentCommitPort,
} from "../../src/contexts/payment-capture/shortcut-ingestion/application/ports/out/shortcutPaymentRecordingPorts";
import type {
  ShortcutPaymentRecordingInputPort,
  ShortcutPaymentRecordingResult,
  ShortcutTransactionDraft,
} from "../../src/contexts/payment-capture/shortcut-ingestion/public";

export interface ShortcutOwnedCardFixture {
  readonly cardId: string;
  readonly householdId: string;
  readonly ownerMemberId: string;
  readonly companyLabel: string;
  readonly lastFour?: string;
  readonly lifecycle: "active" | "retired";
}

export type ShortcutCardReferenceFixture =
  | readonly ShortcutOwnedCardFixture[]
  | { readonly kind: "Unavailable" };

export type ShortcutDefaultCategoryFixture = ShortcutDefaultCategoryResult;

export interface ShortcutPaymentRecordingState {
  readonly transactions: readonly (ShortcutTransactionDraft & {
    readonly transactionId: string;
  })[];
  readonly outboxEventIds: readonly string[];
}

export interface ShortcutPaymentRecordingDriverInput {
  readonly commandId: string;
  readonly actor: { readonly householdId: string; readonly memberId: string };
  readonly parsed: {
    readonly amountInWon: number;
    readonly merchant: string;
    readonly cardEvidence: {
      readonly companyLabel: string;
      readonly maskedToken?: string;
    };
  };
  readonly defaultCategory: ShortcutDefaultCategoryFixture;
  readonly cards: ShortcutCardReferenceFixture;
}

export interface ShortcutPaymentRecordingDriver
  extends Omit<ShortcutPaymentRecordingInputPort, "record"> {
  record(
    input: ShortcutPaymentRecordingDriverInput,
  ): Promise<ShortcutPaymentRecordingResult>;
  state(): ShortcutPaymentRecordingState;
}

class FixtureDefaultCategoryPort implements ShortcutDefaultCategoryPort {
  constructor(private readonly result: ShortcutDefaultCategoryFixture) {}

  async findForHousehold(
    _householdId: string,
  ): Promise<ShortcutDefaultCategoryResult> {
    return { ...this.result };
  }
}

function isUnavailableCards(
  cards: ShortcutCardReferenceFixture,
): cards is { readonly kind: "Unavailable" } {
  return !Array.isArray(cards);
}

class FixtureOwnedCardResolutionPort
  implements ShortcutOwnedCardResolutionPort
{
  constructor(private readonly cards: ShortcutCardReferenceFixture) {}

  async resolve(input: Parameters<ShortcutOwnedCardResolutionPort["resolve"]>[0]) {
    if (isUnavailableCards(this.cards)) return { kind: "Unavailable" } as const;

    const resolution = createOwnCardResolutionPolicy().resolve({
      actingMemberId: input.actor.memberId,
      evidence: input.evidence,
      cards: this.cards
        .filter(({ householdId }) => householdId === input.actor.householdId)
        .map((card) => ({
          cardId: card.cardId,
          ownerMemberId: card.ownerMemberId,
          cardCompany: card.companyLabel,
          lastFour: card.lastFour ?? "",
          lifecycleState: card.lifecycle,
        })),
    });

    return resolution.kind === "eligible"
      ? {
          kind: "Eligible" as const,
          ...(resolution.canonicalEvidence === undefined
            ? {}
            : { canonicalCardId: resolution.canonicalEvidence.cardId }),
        }
      : {
          kind: "Unmatched" as const,
          code: "CARD_NOT_REGISTERED_FOR_ACTOR" as const,
        };
  }
}

class FixtureShortcutPaymentCommitPort implements ShortcutPaymentCommitPort {
  private readonly transactions: Array<
    ShortcutTransactionDraft & { transactionId: string }
  > = [];
  private readonly outboxEventIds: string[] = [];
  private readonly resultsByCommandId = new Map<
    string,
    { readonly kind: "Created"; readonly transactionId: string }
  >();

  constructor(private readonly available: boolean) {}

  async commit(
    input: Parameters<ShortcutPaymentCommitPort["commit"]>[0],
  ) {
    if (!this.available) return { kind: "Unavailable" } as const;

    const replay = this.resultsByCommandId.get(input.commandId);
    if (replay !== undefined) return replay;

    const result = {
      kind: "Created" as const,
      transactionId: `shortcut-transaction-${this.transactions.length + 1}`,
    };
    this.transactions.push({
      transactionId: result.transactionId,
      ...input.transaction,
      cardEvidence: { ...input.transaction.cardEvidence },
    });
    this.outboxEventIds.push(input.outboxEvent.eventId);
    this.resultsByCommandId.set(input.commandId, result);
    return result;
  }

  state(): ShortcutPaymentRecordingState {
    return {
      transactions: this.transactions.map((transaction) => ({
        ...transaction,
        cardEvidence: { ...transaction.cardEvidence },
      })),
      outboxEventIds: [...this.outboxEventIds],
    };
  }
}

export function createShortcutPaymentRecordingDriver(
  fixture: { readonly commitAvailable?: boolean } = {},
): ShortcutPaymentRecordingDriver {
  const commits = new FixtureShortcutPaymentCommitPort(
    fixture.commitAvailable ?? true,
  );

  return {
    async record(input) {
      return createShortcutPaymentRecordingApplication({
        defaultCategories: new FixtureDefaultCategoryPort(
          input.defaultCategory,
        ),
        cards: new FixtureOwnedCardResolutionPort(input.cards),
        commits,
      }).record({
        commandId: input.commandId,
        actor: input.actor,
        parsed: input.parsed,
      });
    },
    characterizeLegacyCardType(input) {
      return createShortcutPaymentRecordingApplication({
        defaultCategories: new FixtureDefaultCategoryPort({ kind: "Missing" }),
        cards: new FixtureOwnedCardResolutionPort([]),
        commits,
      }).characterizeLegacyCardType(input);
    },
    state: () => commits.state(),
  };
}
