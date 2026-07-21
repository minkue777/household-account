import { createAndroidCaptureQueueApplication } from "../../src/contexts/payment-capture/android-payment-ingestion/application/androidCaptureQueueApplication";
import type { CaptureQueueTransportPort } from "../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureQueueTransportPort";
import type {
  CaptureQueueEntryMetadata,
  DecryptedCaptureQueueEntry,
  EncryptedObservationQueuePort,
} from "../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/encryptedObservationQueuePort";
import type { CaptureQueueEntry } from "../../src/contexts/payment-capture/android-payment-ingestion/domain/model/androidCaptureQueue";
import type {
  CaptureQueueBranchName,
  CaptureQueueServerBranchResult,
  CaptureQueueState,
  EnqueueCaptureObservationInput,
  EnqueueCaptureObservationResult,
  FlushCaptureQueueResult,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export type {
  CaptureQueueBranch,
  CaptureQueueBranchName,
  CaptureQueueServerBranchResult,
  CaptureQueueState,
  EnqueueCaptureObservationInput,
  EnqueueCaptureObservationResult,
  FlushCaptureQueueResult,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export interface CaptureQueueBranchLifecycleDriver {
  enqueue(
    input: EnqueueCaptureObservationInput,
  ): EnqueueCaptureObservationResult;
  flush(input: {
    readonly now: string;
    readonly results: Readonly<
      Partial<Record<CaptureQueueBranchName, CaptureQueueServerBranchResult>>
    >;
  }): FlushCaptureQueueResult;
  restartProcess(): CaptureQueueBranchLifecycleDriver;
  changeSession(actor: {
    readonly householdId: string;
    readonly memberId: string;
  }): void;
  logout(): void;
  invalidateKey(reason: "KeyInvalidated" | "DecryptionFailed"): void;
  state(): CaptureQueueState;
}

interface CiphertextRecord {
  readonly observationId: string;
  readonly queuedAt: string;
  readonly ciphertext: string;
}

function encode(entry: CaptureQueueEntry): string {
  return Buffer.from(JSON.stringify(entry), "utf8").toString("base64");
}

function decode(ciphertext: string): CaptureQueueEntry {
  return JSON.parse(Buffer.from(ciphertext, "base64").toString("utf8")) as CaptureQueueEntry;
}

class InMemoryEncryptedObservationQueue
  implements EncryptedObservationQueuePort
{
  private readonly records = new Map<string, CiphertextRecord>();

  enqueue(entry: CaptureQueueEntry): EnqueueCaptureObservationResult {
    if (this.records.has(entry.observationId)) {
      return { kind: "AlreadyQueued", observationId: entry.observationId };
    }
    this.records.set(entry.observationId, {
      observationId: entry.observationId,
      queuedAt: entry.queuedAt,
      ciphertext: encode(entry),
    });
    return { kind: "Queued", observationId: entry.observationId };
  }

  peekOldest(): CaptureQueueEntryMetadata | undefined {
    const oldest = [...this.records.values()].sort((left, right) => {
      const byTime = left.queuedAt.localeCompare(right.queuedAt, "en");
      return byTime === 0
        ? left.observationId.localeCompare(right.observationId, "en")
        : byTime;
    })[0];
    return oldest === undefined
      ? undefined
      : { observationId: oldest.observationId, queuedAt: oldest.queuedAt };
  }

  decrypt(observationId: string): DecryptedCaptureQueueEntry {
    const record = this.records.get(observationId);
    if (record === undefined) {
      return { kind: "Unreadable", reason: "DecryptionFailed" };
    }
    try {
      return { kind: "Ready", entry: decode(record.ciphertext) };
    } catch {
      return { kind: "Unreadable", reason: "DecryptionFailed" };
    }
  }

  replace(entry: CaptureQueueEntry): "stored" | "failed" {
    if (!this.records.has(entry.observationId)) return "failed";
    this.records.set(entry.observationId, {
      observationId: entry.observationId,
      queuedAt: entry.queuedAt,
      ciphertext: encode(entry),
    });
    return "stored";
  }

  delete(observationId: string): void {
    this.records.delete(observationId);
  }

  clear(): void {
    this.records.clear();
  }

  state(transportAttempts: CaptureQueueState["transportAttempts"]): CaptureQueueState {
    return {
      entries: [...this.records.values()].map((record) => {
        const entry = decode(record.ciphertext);
        return {
          ...entry,
          actor: { ...entry.actor },
          pendingBranches: entry.pendingBranches.map((branch) => ({ ...branch })),
          terminalBranches: entry.terminalBranches.map((branch) => ({
            ...branch,
            result: { ...branch.result },
          })),
          atRest: {
            algorithm: "AES-256-GCM" as const,
            keyProvider: "AndroidKeystore" as const,
            ciphertextOnly: true as const,
          },
        };
      }),
      transportAttempts: transportAttempts.map((attempt) => ({ ...attempt })),
      plaintextAtRest: [],
    };
  }
}

class FixtureCaptureQueueTransport implements CaptureQueueTransportPort {
  private results: Readonly<
    Partial<Record<CaptureQueueBranchName, CaptureQueueServerBranchResult>>
  > = {};
  private readonly attempts: {
    observationId: string;
    branch: CaptureQueueBranchName;
    idempotencyKey: string;
  }[] = [];

  respondWith(
    results: Readonly<
      Partial<Record<CaptureQueueBranchName, CaptureQueueServerBranchResult>>
    >,
  ): void {
    this.results = results;
  }

  submit(input: {
    readonly observationId: string;
    readonly branch: {
      readonly branch: CaptureQueueBranchName;
      readonly idempotencyKey: string;
    };
  }): CaptureQueueServerBranchResult {
    this.attempts.push({
      observationId: input.observationId,
      branch: input.branch.branch,
      idempotencyKey: input.branch.idempotencyKey,
    });
    return (
      this.results[input.branch.branch] ?? {
        kind: "RetryableFailure",
        code: "NO_FIXTURE_RESULT",
      }
    );
  }

  state(): CaptureQueueState["transportAttempts"] {
    return this.attempts.map((attempt) => ({ ...attempt }));
  }
}

class DefaultCaptureQueueBranchLifecycleDriver
  implements CaptureQueueBranchLifecycleDriver
{
  private readonly application;

  constructor(
    private readonly queue: InMemoryEncryptedObservationQueue,
    private readonly transport: FixtureCaptureQueueTransport,
  ) {
    this.application = createAndroidCaptureQueueApplication({
      queue,
      transport,
    });
  }

  enqueue(
    input: EnqueueCaptureObservationInput,
  ): EnqueueCaptureObservationResult {
    return this.application.enqueue(input);
  }

  flush(input: {
    readonly now: string;
    readonly results: Readonly<
      Partial<Record<CaptureQueueBranchName, CaptureQueueServerBranchResult>>
    >;
  }): FlushCaptureQueueResult {
    this.transport.respondWith(input.results);
    return this.application.flush({ now: input.now });
  }

  restartProcess(): CaptureQueueBranchLifecycleDriver {
    return new DefaultCaptureQueueBranchLifecycleDriver(
      this.queue,
      this.transport,
    );
  }

  changeSession(actor: {
    readonly householdId: string;
    readonly memberId: string;
  }): void {
    this.application.changeSession(actor);
  }

  logout(): void {
    this.application.logout();
  }

  invalidateKey(reason: "KeyInvalidated" | "DecryptionFailed"): void {
    this.application.discardUnreadableQueue(reason);
  }

  state(): CaptureQueueState {
    return this.queue.state(this.transport.state());
  }
}

export function createCaptureQueueBranchLifecycleDriver(): CaptureQueueBranchLifecycleDriver {
  return new DefaultCaptureQueueBranchLifecycleDriver(
    new InMemoryEncryptedObservationQueue(),
    new FixtureCaptureQueueTransport(),
  );
}
