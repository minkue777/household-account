import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type { CaptureSubmissionInputPort } from "../../../contexts/payment-capture/android-payment-ingestion/public";
import type { ShortcutCredentialLifecycleInputPort } from "../../../contexts/payment-capture/shortcut-ingestion/application/ports/in/shortcutCredentialLifecycleInputPort";
import type {
  ShortcutHttpCredentialAuthorizationPort,
  ShortcutHttpCredentialGatePort,
  ShortcutHttpHashPort,
  ShortcutHttpIngressGatePort,
  ShortcutHttpPaymentIntakePort,
  ShortcutHttpReceiptClaimResult,
  ShortcutHttpReceiptPort,
} from "../../../contexts/payment-capture/shortcut-ingestion/application/ports/out/shortcutHttpInboundPorts";
import type { ShortcutHttpRequestProcessingResult } from "../../../contexts/payment-capture/shortcut-ingestion/domain/model/shortcutHttpInbound";
import { HmacShortcutCredentialSecretAdapter } from "./firebaseShortcutCredentialInfrastructure";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export class Sha256ShortcutHttpHashAdapter implements ShortcutHttpHashPort {
  hash(value: string): string {
    return sha256(value);
  }
}

export class FirebaseShortcutHttpCredentialAuthorizationAdapter
  implements ShortcutHttpCredentialAuthorizationPort
{
  constructor(private readonly lifecycle: ShortcutCredentialLifecycleInputPort) {}

  async authorize(input: {
    readonly bearerCredential: string | null;
    readonly requestedAt: string;
  }) {
    const credentialId =
      input.bearerCredential === null
        ? undefined
        : HmacShortcutCredentialSecretAdapter.credentialId(
            input.bearerCredential,
          );
    if (credentialId === undefined) {
      return { kind: "unauthenticated" as const, code: "AUTH_REQUIRED" as const };
    }
    const result = await this.lifecycle.authorize({
      bearerCredential: input.bearerCredential,
      requestedAt: input.requestedAt,
      distinguishReplacement: true,
    });
    if (result.kind === "authorized") {
      return {
        kind: "authorized" as const,
        credential: { credentialId, actor: result.actor },
      };
    }
    return result.kind === "forbidden"
      ? { kind: "forbidden" as const, code: result.code }
      : { kind: "unauthenticated" as const, code: result.code };
  }
}

export interface ShortcutIngressRateLimits {
  readonly maxIpRequestsPerMinute: number;
  readonly maxCredentialRequestsPerMinute: number;
  readonly maxCredentialRequestsPerDay: number;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid Shortcut rate limit: ${name}`);
  }
  return value;
}

function seoulDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export class FirebaseShortcutIngressGateAdapter
  implements ShortcutHttpIngressGatePort, ShortcutHttpCredentialGatePort
{
  private readonly limits: ShortcutIngressRateLimits;

  constructor(
    private readonly database: firestore.Firestore,
    limits: ShortcutIngressRateLimits,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.limits = {
      maxIpRequestsPerMinute: positiveInteger(
        limits.maxIpRequestsPerMinute,
        "maxIpRequestsPerMinute",
      ),
      maxCredentialRequestsPerMinute: positiveInteger(
        limits.maxCredentialRequestsPerMinute,
        "maxCredentialRequestsPerMinute",
      ),
      maxCredentialRequestsPerDay: positiveInteger(
        limits.maxCredentialRequestsPerDay,
        "maxCredentialRequestsPerDay",
      ),
    };
  }

  async evaluateIp(remoteAddress: string) {
    const now = this.now();
    const minute = Math.floor(now.getTime() / 60_000);
    const allowed = await this.claim([
      {
        id: sha256(`ip-minute\u0000${remoteAddress}\u0000${minute}`),
        scope: "ip-minute",
        limit: this.limits.maxIpRequestsPerMinute,
        expiresAt: new Date((minute + 2) * 60_000),
      },
    ]);
    return allowed
      ? ({ kind: "allowed" } as const)
      : ({ kind: "rate-limited" } as const);
  }

  async evaluate(credentialId: string) {
    const now = this.now();
    const minute = Math.floor(now.getTime() / 60_000);
    const date = seoulDate(now);
    const outcome = await this.claimDetailed([
      {
        id: sha256(
          `credential-minute\u0000${credentialId}\u0000${minute}`,
        ),
        scope: "credential-minute",
        limit: this.limits.maxCredentialRequestsPerMinute,
        expiresAt: new Date((minute + 2) * 60_000),
      },
      {
        id: sha256(`credential-day\u0000${credentialId}\u0000${date}`),
        scope: "credential-day",
        limit: this.limits.maxCredentialRequestsPerDay,
        expiresAt: new Date(now.getTime() + 3 * 24 * 60 * 60_000),
      },
    ]);
    if (outcome === "allowed") return { kind: "allowed" as const };
    return outcome === "credential-day"
      ? ({ kind: "quota-exceeded" } as const)
      : ({ kind: "rate-limited" } as const);
  }

  private async claim(counters: readonly CounterClaim[]): Promise<boolean> {
    return (await this.claimDetailed(counters)) === "allowed";
  }

  private async claimDetailed(
    counters: readonly CounterClaim[],
  ): Promise<"allowed" | string> {
    return this.database.runTransaction(async (transaction) => {
      const references = counters.map((counter) =>
        this.database.collection("shortcutIngressCounters").doc(counter.id),
      );
      const snapshots = await Promise.all(
        references.map((reference) => transaction.get(reference)),
      );
      for (let index = 0; index < counters.length; index += 1) {
        const count = snapshots[index].data()?.count;
        if (typeof count === "number" && count >= counters[index].limit) {
          return counters[index].scope;
        }
      }
      for (let index = 0; index < counters.length; index += 1) {
        const counter = counters[index];
        const current = snapshots[index].data()?.count;
        transaction.set(
          references[index],
          {
            scope: counter.scope,
            count: typeof current === "number" ? current + 1 : 1,
            expiresAt: counter.expiresAt,
            updatedAt: FieldValue.serverTimestamp(),
            schemaVersion: 1,
          },
          { merge: true },
        );
      }
      return "allowed";
    });
  }
}

interface CounterClaim {
  readonly id: string;
  readonly scope: string;
  readonly limit: number;
  readonly expiresAt: Date;
}

const RECEIPT_LEASE_MS = 30_000;
const RECEIPT_RETENTION_MS = 3 * 24 * 60 * 60_000;

export class FirebaseShortcutHttpReceiptAdapter
  implements ShortcutHttpReceiptPort
{
  constructor(private readonly database: firestore.Firestore) {}

  private reference(receiptKey: string) {
    return this.database.collection("shortcutHttpReceipts").doc(sha256(receiptKey));
  }

  async claim(input: {
    readonly receiptKey: string;
    readonly payloadHash: string;
  }): Promise<ShortcutHttpReceiptClaimResult> {
    const reference = this.reference(input.receiptKey);
    const now = Date.now();
    return this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const data = snapshot.data();
      if (data !== undefined) {
        if (data.payloadHash !== input.payloadHash) {
          return { kind: "payload-mismatch" } as const;
        }
        if (data.status === "completed" && data.result !== undefined) {
          return {
            kind: "completed" as const,
            result: data.result as ShortcutHttpRequestProcessingResult,
          };
        }
        const lease =
          typeof data.leaseExpiresAt === "string"
            ? Date.parse(data.leaseExpiresAt)
            : Number.POSITIVE_INFINITY;
        if (Number.isFinite(lease) && lease > now) {
          return { kind: "in-progress" } as const;
        }
      }
      transaction.set(reference, {
        receiptKeyHash: sha256(input.receiptKey),
        payloadHash: input.payloadHash,
        status: "processing",
        leaseExpiresAt: new Date(now + RECEIPT_LEASE_MS).toISOString(),
        expiresAt: new Date(now + RECEIPT_RETENTION_MS),
        schemaVersion: 1,
        updatedAt: FieldValue.serverTimestamp(),
        ...(snapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      });
      return { kind: "claimed" } as const;
    });
  }

  async complete(input: {
    readonly receiptKey: string;
    readonly result: ShortcutHttpRequestProcessingResult;
  }): Promise<void> {
    await this.reference(input.receiptKey).set(
      {
        status: "completed",
        result: input.result,
        leaseExpiresAt: null,
        completedAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  async abandon(input: {
    readonly receiptKey: string;
    readonly result?: ShortcutHttpRequestProcessingResult;
  }): Promise<void> {
    const reference = this.reference(input.receiptKey);
    if (
      input.result !== undefined &&
      input.result.kind === "error" &&
      !input.result.retryable
    ) {
      await this.complete({ receiptKey: input.receiptKey, result: input.result });
      return;
    }
    await reference.delete();
  }

  async waitForCompletion(
    receiptKey: string,
  ): Promise<ShortcutHttpRequestProcessingResult> {
    const reference = this.reference(receiptKey);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const snapshot = await reference.get();
      const data = snapshot.data();
      if (data?.status === "completed" && data.result !== undefined) {
        return data.result as ShortcutHttpRequestProcessingResult;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    return {
      kind: "error",
      code: "PAYMENT_INTAKE_TEMPORARILY_UNAVAILABLE",
      retryable: true,
    };
  }
}

export class FirebaseShortcutCaptureIntakeAdapter
  implements ShortcutHttpPaymentIntakePort
{
  constructor(private readonly submissions: CaptureSubmissionInputPort) {}

  async submit(input: Parameters<ShortcutHttpPaymentIntakePort["submit"]>[0]) {
    const outcome = await this.submissions.submit({
      actor: {
        principalId: input.actor.principalUid,
        householdId: input.actor.householdId,
        actingMemberId: input.actor.actingMemberId,
        capabilities: ["paymentCapture:submit"],
      },
      rootIdempotencyKey: input.commandId,
      envelope: {
        contractVersion: "capture-envelope.v1",
        observationId: input.commandId,
        originChannel: "ios-shortcut",
        sourceEvidence: {
          kind: "ios-shortcut-credential",
          sourceType: "ios-shortcut",
          credentialIdHash: `sha256:${sha256(input.credentialId)}`,
        },
        observedAt: input.requestedAt,
        parser: {
          parserId: "shortcut-card-message-parser",
          parserVersion: "1.0.0",
        },
        rawPayloadHash: `sha256:${input.payloadHash}`,
        paymentObservation: {
          branchId: `${input.commandId}:payment`,
          observationType: "approval",
          amountInWon: input.parsed.amountInWon,
          occurredLocalDate: input.parsed.occurredLocalDate,
          occurredLocalTime: input.parsed.occurredLocalTime,
          zoneId: "Asia/Seoul",
          merchantEvidence: { rawCandidate: input.parsed.merchant },
          cardEvidence: input.parsed.cardEvidence,
        },
      },
    });
    if (outcome.kind !== "success") return { kind: "retryable-failure" as const };
    const transaction = outcome.value.transactionResult;
    if (transaction?.kind === "created") {
      return { kind: "created" as const, transactionId: transaction.transactionId };
    }
    if (transaction?.kind === "duplicate") {
      return {
        kind: "duplicate" as const,
        existingTransactionId: transaction.existingTransactionId,
      };
    }
    if (
      transaction?.kind === "rejected" &&
      (transaction.code === "CARD_NOT_REGISTERED_FOR_ACTOR" ||
        transaction.code === "CARD_NOT_REGISTERED")
    ) {
      return {
        kind: "rejected" as const,
        code: "CARD_NOT_REGISTERED_FOR_ACTOR" as const,
      };
    }
    return { kind: "retryable-failure" as const };
  }
}
