import { createHash } from "node:crypto";

import { createShortcutHttpRequestProcessorApplication } from "../../src/contexts/payment-capture/shortcut-ingestion/application/shortcutHttpRequestProcessorApplication";
import type {
  ShortcutHttpCredentialAuthorizationPort,
  ShortcutHttpCredentialGatePort,
  ShortcutHttpHashPort,
  ShortcutHttpPaymentIntakePort,
  ShortcutHttpReceiptClaimResult,
  ShortcutHttpReceiptPort,
} from "../../src/contexts/payment-capture/shortcut-ingestion/application/ports/out/shortcutHttpInboundPorts";
import {
  createShortcutHttpInboundHandler,
  type ShortcutHttpInboundRequest,
  type ShortcutHttpInboundResponse,
  type ShortcutHttpIngressGatePort,
} from "../../src/contexts/payment-capture/shortcut-ingestion/adapters/in/http/shortcutHttpInboundHandler";
import {
  createShortcutCardMessageParser,
  createShortcutValueNormalizer,
  type ShortcutHttpAuthorizationDecision,
  type ShortcutHttpRequestProcessingResult,
} from "../../src/contexts/payment-capture/shortcut-ingestion/public";
import { createShortcutCredentialLifecycleDriver } from "./shortcut-credential-lifecycle-driver";
import { createShortcutPaymentRecordingDriver } from "./shortcut-payment-recording-driver";

export interface ShortcutHttpInboundDriverFixture {
  readonly limits: {
    readonly maxBodyBytes: number;
    readonly maxMessageChars: number;
    readonly maxIdempotencyKeyChars: number;
  };
  readonly credentials: readonly {
    readonly rawCredential: string;
    readonly credentialId: string;
    readonly subjectUid: string;
    readonly householdId: string;
    readonly memberId: string;
    readonly capabilities: readonly string[];
    readonly keyVersion: string;
    readonly status: "active" | "revoked";
  }[];
  readonly memberships: readonly {
    readonly principalUid: string;
    readonly householdId: string;
    readonly memberId: string;
    readonly membershipState: "active" | "removed";
    readonly householdState: "active" | "deleted" | "purging";
  }[];
  readonly cards: readonly {
    readonly householdId: string;
    readonly ownerMemberId: string;
    readonly cardCompany: string;
    readonly lastFour: string;
    readonly lifecycleState: "active" | "retired";
  }[];
  readonly invitationCodes?: readonly string[];
  readonly ingressGate?:
    | "allowed"
    | "ip-rate-limited"
    | "credential-rate-limited"
    | "quota-exceeded";
  readonly intakeOutcome?: "success" | "duplicate" | "retryable-failure";
}

export interface ShortcutHttpInboundDriverSnapshot {
  readonly transactions: readonly {
    readonly transactionId: string;
    readonly householdId: string;
    readonly creatorMemberId: string;
    readonly source: "ios-shortcut";
    readonly amountInWon: number;
    readonly merchant: string;
  }[];
  readonly events: readonly {
    readonly eventName:
      | "TransactionRecorded.v1"
      | "CaptureDuplicateObserved.v1";
    readonly eventId: string;
    readonly producer:
      | "household-finance.ledger"
      | "payment-capture.intake";
    readonly householdId: string;
    readonly creatorMemberId: string;
  }[];
}

export interface ShortcutHttpInboundDriver {
  handle(request: ShortcutHttpInboundRequest): Promise<ShortcutHttpInboundResponse>;
  handleConcurrently(
    requests: readonly ShortcutHttpInboundRequest[],
  ): Promise<readonly ShortcutHttpInboundResponse[]>;
  snapshot(): ShortcutHttpInboundDriverSnapshot;
}

class FixtureShortcutHttpCredentialAuthorizationPort
  implements ShortcutHttpCredentialAuthorizationPort
{
  private readonly lifecycle;

  constructor(private readonly fixture: ShortcutHttpInboundDriverFixture) {
    this.lifecycle = createShortcutCredentialLifecycleDriver({
      sessions: fixture.memberships,
      invitationCodes: (fixture.invitationCodes ?? []).map((rawCode) => ({
        rawCode,
        householdId: "fixture-invitation-household",
        issuedAt: "2026-07-19T08:55:00+09:00",
        expiresAt: "2026-07-19T09:00:00+09:00",
        status: "unused" as const,
      })),
      credentials: fixture.credentials.map((credential) => ({
        testOnlyRawCredential: credential.rawCredential,
        credentialId: credential.credentialId,
        credentialVersion: 1,
        subjectUid: credential.subjectUid,
        householdId: credential.householdId,
        memberId: credential.memberId,
        capabilities: ["paymentCapture:submit"] as const,
        issuedAt: "2026-07-01T09:00:00+09:00",
        keyVersion: credential.keyVersion,
        status: credential.status,
      })),
    });
  }

  async authorize(input: {
    bearerCredential: string | null;
    requestedAt: string;
  }): Promise<ShortcutHttpAuthorizationDecision> {
    const authorization = await this.lifecycle.authorize(input);
    if (authorization.kind === "unauthenticated") {
      return {
        kind: "unauthenticated",
        code:
          authorization.code === "CREDENTIAL_REPLACED"
            ? "CREDENTIAL_REVOKED"
            : authorization.code,
      };
    }
    if (authorization.kind === "forbidden") {
      return { kind: "forbidden", code: authorization.code };
    }

    const fixtureCredential = this.fixture.credentials.find(
      ({ rawCredential }) => rawCredential === input.bearerCredential,
    );
    if (
      fixtureCredential === undefined ||
      !fixtureCredential.capabilities.includes("paymentCapture:submit")
    ) {
      return { kind: "forbidden", code: "HOUSEHOLD_FORBIDDEN" };
    }
    return {
      kind: "authorized",
      credential: {
        credentialId: fixtureCredential.credentialId,
        actor: authorization.actor,
      },
    };
  }
}

class FixtureShortcutHttpHashPort implements ShortcutHttpHashPort {
  hash(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
  }
}

interface ReceiptEntry {
  readonly payloadHash: string;
  status: "processing" | "completed";
  result?: ShortcutHttpRequestProcessingResult;
}

class InMemoryShortcutHttpReceiptPort implements ShortcutHttpReceiptPort {
  private readonly entries = new Map<string, ReceiptEntry>();
  private readonly waiters = new Map<
    string,
    Array<(result: ShortcutHttpRequestProcessingResult) => void>
  >();

  async claim(input: {
    receiptKey: string;
    payloadHash: string;
  }): Promise<ShortcutHttpReceiptClaimResult> {
    const existing = this.entries.get(input.receiptKey);
    if (existing !== undefined) {
      if (existing.payloadHash !== input.payloadHash) {
        return { kind: "payload-mismatch" };
      }
      return existing.status === "completed" && existing.result !== undefined
        ? { kind: "completed", result: existing.result }
        : { kind: "in-progress" };
    }
    this.entries.set(input.receiptKey, {
      payloadHash: input.payloadHash,
      status: "processing",
    });
    return { kind: "claimed" };
  }

  async complete(input: {
    receiptKey: string;
    result: ShortcutHttpRequestProcessingResult;
  }): Promise<void> {
    const entry = this.entries.get(input.receiptKey);
    if (entry === undefined) return;
    entry.status = "completed";
    entry.result = input.result;
    this.resolveWaiters(input.receiptKey, input.result);
  }

  async abandon(input: {
    receiptKey: string;
    result?: ShortcutHttpRequestProcessingResult;
  }): Promise<void> {
    this.entries.delete(input.receiptKey);
    if (input.result !== undefined) {
      this.resolveWaiters(input.receiptKey, input.result);
    }
  }

  waitForCompletion(
    receiptKey: string,
  ): Promise<ShortcutHttpRequestProcessingResult> {
    const entry = this.entries.get(receiptKey);
    if (entry?.status === "completed" && entry.result !== undefined) {
      return Promise.resolve(entry.result);
    }
    return new Promise((resolve) => {
      const waiters = this.waiters.get(receiptKey) ?? [];
      waiters.push(resolve);
      this.waiters.set(receiptKey, waiters);
    });
  }

  private resolveWaiters(
    receiptKey: string,
    result: ShortcutHttpRequestProcessingResult,
  ): void {
    for (const resolve of this.waiters.get(receiptKey) ?? []) resolve(result);
    this.waiters.delete(receiptKey);
  }
}

class FixtureShortcutHttpIngressGate implements ShortcutHttpIngressGatePort {
  constructor(
    private readonly gate: NonNullable<
      ShortcutHttpInboundDriverFixture["ingressGate"]
    >,
  ) {}

  async evaluateIp(_remoteAddress: string) {
    return this.gate === "ip-rate-limited"
      ? ({ kind: "rate-limited" } as const)
      : ({ kind: "allowed" } as const);
  }
}

class FixtureShortcutHttpCredentialGate
  implements ShortcutHttpCredentialGatePort
{
  constructor(
    private readonly gate: NonNullable<
      ShortcutHttpInboundDriverFixture["ingressGate"]
    >,
  ) {}

  async evaluate(_credentialId: string) {
    return this.gate === "quota-exceeded"
      ? ({ kind: "quota-exceeded" } as const)
      : this.gate === "credential-rate-limited"
        ? ({ kind: "rate-limited" } as const)
        : ({ kind: "allowed" } as const);
  }
}

export function createShortcutHttpInboundDriver(
  fixture: ShortcutHttpInboundDriverFixture,
): ShortcutHttpInboundDriver {
  const duplicateEvents: Array<{
    readonly eventName: "CaptureDuplicateObserved.v1";
    readonly eventId: string;
    readonly producer: "payment-capture.intake";
    readonly householdId: string;
    readonly creatorMemberId: string;
  }> = [];
  const recording = createShortcutPaymentRecordingDriver({
    commitAvailable: fixture.intakeOutcome !== "retryable-failure",
  });
  const intake: ShortcutHttpPaymentIntakePort = {
    async submit(input) {
      if (fixture.intakeOutcome === "duplicate") {
        duplicateEvents.push({
          eventName: "CaptureDuplicateObserved.v1",
          eventId: `${input.commandId}:capture-duplicate-observed`,
          producer: "payment-capture.intake",
          householdId: input.actor.householdId,
          creatorMemberId: input.actor.actingMemberId,
        });
        return {
          kind: "duplicate",
          existingTransactionId: "transaction-existing",
        };
      }
      const result = await recording.record({
        commandId: input.commandId,
        actor: {
          householdId: input.actor.householdId,
          memberId: input.actor.actingMemberId,
        },
        parsed: {
          amountInWon: input.parsed.amountInWon,
          merchant: input.parsed.merchant,
          cardEvidence: input.parsed.cardEvidence,
        },
        defaultCategory: {
          kind: "Found",
          categoryId: "category-default",
        },
        cards: fixture.cards.map((card, index) => ({
          cardId: `fixture-card-${index + 1}`,
          householdId: card.householdId,
          ownerMemberId: card.ownerMemberId,
          companyLabel: card.cardCompany,
          lastFour: card.lastFour,
          lifecycle: card.lifecycleState,
        })),
      });
      if (result.kind === "Created") {
        return { kind: "created", transactionId: result.transactionId };
      }
      if (
        result.kind === "Rejected" &&
        result.code === "CARD_NOT_REGISTERED_FOR_ACTOR"
      ) {
        return { kind: "rejected", code: result.code };
      }
      return { kind: "retryable-failure" };
    },
  };
  const processor = createShortcutHttpRequestProcessorApplication({
    credentials: new FixtureShortcutHttpCredentialAuthorizationPort(fixture),
    credentialGate: new FixtureShortcutHttpCredentialGate(
      fixture.ingressGate ?? "allowed",
    ),
    parser: createShortcutCardMessageParser(),
    intake,
    receipts: new InMemoryShortcutHttpReceiptPort(),
    hashes: new FixtureShortcutHttpHashPort(),
  });
  const handler = createShortcutHttpInboundHandler({
    limits: fixture.limits,
    normalizer: createShortcutValueNormalizer(),
    processor,
    ingressGate: new FixtureShortcutHttpIngressGate(
      fixture.ingressGate ?? "allowed",
    ),
  });

  return {
    handle: (request) => handler.handle(request),
    handleConcurrently: (requests) =>
      Promise.all(requests.map((request) => handler.handle(request))),
    snapshot() {
      const state = recording.state();
      const transactions = state.transactions.map((transaction) => ({
        transactionId: transaction.transactionId,
        householdId: transaction.householdId,
        creatorMemberId: transaction.creatorMemberId,
        source: transaction.source,
        amountInWon: transaction.amountInWon,
        merchant: transaction.merchant,
      }));
      return {
        transactions,
        events: [
          ...state.outboxEventIds.map((eventId, index) => ({
            eventName: "TransactionRecorded.v1" as const,
            eventId,
            producer: "household-finance.ledger" as const,
            householdId: transactions[index].householdId,
            creatorMemberId: transactions[index].creatorMemberId,
          })),
          ...duplicateEvents.map((event) => ({ ...event })),
        ],
      };
    },
  };
}
