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
  readonly invitationCodes?: readonly string[];
  readonly ingressGate?:
    | "allowed"
    | "ip-rate-limited"
    | "credential-rate-limited"
    | "quota-exceeded";
  readonly intakeOutcome?:
    | "success"
    | "card-unmatched"
    | "duplicate"
    | "cancelled"
    | "cancellation-not-found"
    | "needs-confirmation"
    | "retryable-failure";
}

export type ShortcutIntakeRequest = Parameters<ShortcutHttpPaymentIntakePort["submit"]>[0];

export interface ShortcutHttpInboundDriver {
  handle(request: ShortcutHttpInboundRequest): Promise<ShortcutHttpInboundResponse>;
  handleConcurrently(
    requests: readonly ShortcutHttpInboundRequest[],
  ): Promise<readonly ShortcutHttpInboundResponse[]>;
  intakeRequests(): readonly ShortcutIntakeRequest[];
  intakeSubmissionCount(): number;
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
  // HTTP 경계만 검증하는 명시적 stub입니다. 거래/Outbox를 재구현하지 않습니다.
  // 실제 저장·카드 판정·중복 event는 Capture adapter 및 E2E에서 검증합니다.
  const intakeRequests: ShortcutIntakeRequest[] = [];
  const intake: ShortcutHttpPaymentIntakePort = {
    async submit(input) {
      intakeRequests.push(structuredClone(input));
      switch (fixture.intakeOutcome) {
        case "retryable-failure": return { kind: "retryable-failure" };
        case "card-unmatched": return { kind: "rejected", code: "CARD_NOT_REGISTERED_FOR_ACTOR" };
        case "duplicate": return { kind: "duplicate", existingTransactionId: "transaction-existing" };
        case "cancellation-not-found": return { kind: "cancellation-not-found" };
        case "needs-confirmation": return { kind: "needs-confirmation", captureLineageIds: ["capture-lineage-candidate-a", "capture-lineage-candidate-b"] };
        case "cancelled": return { kind: "cancelled", transactionIds: ["transaction-cancelled-original"] };
        default: return { kind: "created", transactionId: "transaction-created" };
      }
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
    intakeSubmissionCount: () => intakeRequests.length,
    intakeRequests: () => structuredClone(intakeRequests),
  };
}
