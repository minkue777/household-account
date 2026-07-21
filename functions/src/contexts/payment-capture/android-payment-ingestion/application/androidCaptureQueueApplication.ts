import type {
  EnqueueCaptureObservationInput,
  EnqueueCaptureObservationResult,
  FlushCaptureQueueResult,
} from "../domain/model/androidCaptureQueue";
import {
  applyCaptureQueueBranchResults,
  captureQueueBranchSetIsValid,
  captureQueueEntryIsExpired,
  createCaptureQueueEntry,
} from "../domain/policies/captureQueueLifecyclePolicy";
import type { AndroidCaptureQueueInputPort } from "./ports/in/androidCaptureQueueInputPort";
import type { CaptureQueueTransportPort } from "./ports/out/captureQueueTransportPort";
import type { EncryptedObservationQueuePort } from "./ports/out/encryptedObservationQueuePort";

export interface AndroidCaptureQueueDependencies {
  readonly queue: EncryptedObservationQueuePort;
  readonly transport: CaptureQueueTransportPort;
}

class DefaultAndroidCaptureQueueApplication
  implements AndroidCaptureQueueInputPort
{
  constructor(private readonly dependencies: AndroidCaptureQueueDependencies) {}

  enqueue(
    input: EnqueueCaptureObservationInput,
  ): EnqueueCaptureObservationResult {
    if (!captureQueueBranchSetIsValid(input)) {
      return { kind: "LocalFailure", code: "INVALID_BRANCH_SET" };
    }
    return this.dependencies.queue.enqueue(createCaptureQueueEntry(input));
  }

  flush(input: { readonly now: string }): FlushCaptureQueueResult {
    const metadata = this.dependencies.queue.peekOldest();
    if (metadata === undefined) return { kind: "Idle", pendingBranches: [] };
    if (
      captureQueueEntryIsExpired({
        queuedAt: metadata.queuedAt,
        now: input.now,
      })
    ) {
      this.dependencies.queue.delete(metadata.observationId);
      return {
        kind: "Deleted",
        pendingBranches: [],
        deletionReason: "Expired",
      };
    }

    const decrypted = this.dependencies.queue.decrypt(metadata.observationId);
    if (decrypted.kind === "Unreadable") {
      this.dependencies.queue.delete(metadata.observationId);
      return {
        kind: "Deleted",
        pendingBranches: [],
        deletionReason: decrypted.reason,
      };
    }

    const results = new Map(
      decrypted.entry.pendingBranches.map((branch) => [
        branch.branch,
        this.dependencies.transport.submit({
          observationId: decrypted.entry.observationId,
          branch,
        }),
      ]),
    );
    const nextEntry = applyCaptureQueueBranchResults({
      entry: decrypted.entry,
      results,
    });
    if (nextEntry.pendingBranches.length === 0) {
      this.dependencies.queue.delete(nextEntry.observationId);
      return {
        kind: "Deleted",
        pendingBranches: [],
        deletionReason: "AllBranchesTerminal",
      };
    }
    if (this.dependencies.queue.replace(nextEntry) === "failed") {
      return {
        kind: "Retained",
        pendingBranches: decrypted.entry.pendingBranches.map(
          ({ branch }) => branch,
        ),
      };
    }
    return {
      kind: "Retained",
      pendingBranches: nextEntry.pendingBranches.map(({ branch }) => branch),
    };
  }

  changeSession(actor: {
    readonly householdId: string;
    readonly memberId: string;
  }): void {
    void actor;
    this.dependencies.queue.clear();
  }

  logout(): void {
    this.dependencies.queue.clear();
  }

  discardUnreadableQueue(
    reason: "KeyInvalidated" | "DecryptionFailed",
  ): void {
    void reason;
    this.dependencies.queue.clear();
  }
}

export function createAndroidCaptureQueueApplication(
  dependencies: AndroidCaptureQueueDependencies,
): AndroidCaptureQueueInputPort {
  return new DefaultAndroidCaptureQueueApplication(dependencies);
}
