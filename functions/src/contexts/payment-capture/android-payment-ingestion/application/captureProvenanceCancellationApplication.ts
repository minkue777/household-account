import type {
  ApprovalCaptureInput,
  ApprovalCaptureResult,
  ProvenanceCancellationResult,
} from "../domain/model/captureProvenance";
import {
  decideCaptureApproval,
  decideProvenanceCancellation,
} from "../domain/policies/captureProvenancePolicy";
import type {
  CancelByProvenanceInput,
  CaptureProvenanceCancellationInputPort,
} from "./ports/in/captureProvenanceCancellationInputPort";
import type { CaptureProvenanceLedgerPort } from "./ports/out/captureProvenanceLedgerPort";

const USER_COMMANDS = [
  "CaptureApproval",
  "CancelCapturedLineage",
] as const;

class DefaultCaptureProvenanceCancellationApplication
  implements CaptureProvenanceCancellationInputPort
{
  constructor(private readonly ledger: CaptureProvenanceLedgerPort) {}

  captureApproval(input: ApprovalCaptureInput): ApprovalCaptureResult {
    const current = this.ledger.load();
    const decision = decideCaptureApproval(current, input);
    if (decision.nextState === undefined) return decision.result;

    if (this.ledger.commit(current.revision, decision.nextState) === "failed") {
      throw new Error("capture provenance 원자 저장에 실패했습니다.");
    }
    return decision.result;
  }

  cancel(input: CancelByProvenanceInput): ProvenanceCancellationResult {
    const current = this.ledger.load();
    const decision = decideProvenanceCancellation({
      state: current,
      householdId: input.actor.householdId,
      evidence: input.evidence,
      nextRestoredTransactionId: () =>
        this.ledger.nextRestoredTransactionId(),
    });
    if (decision.nextState === undefined) return decision.result;

    if (this.ledger.commit(current.revision, decision.nextState) === "failed") {
      return { kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" };
    }
    return decision.result;
  }

  availableUserCommands(): readonly string[] {
    return [...USER_COMMANDS];
  }
}

export function createCaptureProvenanceCancellationApplication(
  ledger: CaptureProvenanceLedgerPort,
): CaptureProvenanceCancellationInputPort {
  return new DefaultCaptureProvenanceCancellationApplication(ledger);
}
