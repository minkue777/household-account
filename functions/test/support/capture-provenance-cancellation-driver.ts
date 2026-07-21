import { createCaptureProvenanceCancellationApplication } from "../../src/contexts/payment-capture/android-payment-ingestion/application/captureProvenanceCancellationApplication";
import type { CaptureProvenanceLedgerPort } from "../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureProvenanceLedgerPort";
import {
  captureFingerprint,
  cloneCaptureProvenanceAggregateState,
} from "../../src/contexts/payment-capture/android-payment-ingestion/domain/policies/captureProvenancePolicy";
import type { CaptureProvenanceAggregateState } from "../../src/contexts/payment-capture/android-payment-ingestion/domain/model/captureProvenance";
import type {
  ApprovalCaptureInput,
  ApprovalCaptureResult,
  CancellationEvidence,
  CaptureProvenanceState,
  CapturedTransaction,
  ProvenanceCancellationResult,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export type {
  ApprovalCaptureInput,
  ApprovalCaptureResult,
  CancellationEvidence,
  CaptureProvenance,
  CaptureProvenanceState,
  CapturedTransaction,
  ProvenanceCancellationResult,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export interface CaptureProvenanceCancellationFixture {
  readonly transactions?: readonly CapturedTransaction[];
  readonly legacyIncompleteLineageIds?: readonly string[];
}

export interface CaptureProvenanceCancellationDriver {
  captureApproval(input: ApprovalCaptureInput): ApprovalCaptureResult;
  cancel(input: {
    readonly actor: { readonly householdId: string; readonly memberId: string };
    readonly evidence: CancellationEvidence;
    readonly commitOutcome?: "success" | "failure";
  }): ProvenanceCancellationResult;
  availableUserCommands(): readonly string[];
  state(): CaptureProvenanceState;
}

class InMemoryCaptureProvenanceLedger implements CaptureProvenanceLedgerPort {
  private aggregate: CaptureProvenanceAggregateState;
  private revision = 0;
  private restorationSequence = 0;
  private failNextCommit = false;

  constructor(initial: CaptureProvenanceAggregateState) {
    this.aggregate = cloneCaptureProvenanceAggregateState(initial);
  }

  load() {
    return {
      revision: this.revision,
      ...cloneCaptureProvenanceAggregateState(this.aggregate),
    };
  }

  nextRestoredTransactionId(): string {
    this.restorationSequence += 1;
    return `restored-transaction-${this.restorationSequence}`;
  }

  commit(
    expectedRevision: number,
    nextState: CaptureProvenanceAggregateState,
  ): "committed" | "failed" {
    if (this.failNextCommit || expectedRevision !== this.revision) {
      this.failNextCommit = false;
      return "failed";
    }
    this.aggregate = cloneCaptureProvenanceAggregateState(nextState);
    this.revision += 1;
    return "committed";
  }

  failCommitOnce(): void {
    this.failNextCommit = true;
  }

  state(): CaptureProvenanceState {
    const state = cloneCaptureProvenanceAggregateState(this.aggregate);
    return {
      transactions: state.transactions,
      dedupClaims: state.dedupClaims.map(
        ({ fingerprint, transactionId, state: claimState }) => ({
          fingerprint,
          transactionId,
          state: claimState,
        }),
      ),
      cancellationReceipts: state.cancellationReceipts,
      rawPayloads: [],
    };
  }
}

function initialState(
  fixture: CaptureProvenanceCancellationFixture,
): CaptureProvenanceAggregateState {
  const transactions = fixture.transactions ?? [];
  const orderedLineageIds = [
    ...new Set(
      transactions.flatMap((transaction) => transaction.captureLineageIds),
    ),
  ];
  const dedupClaims = orderedLineageIds.flatMap((captureLineageId) => {
    const candidates = transactions.filter((transaction) =>
      transaction.captureLineageIds.includes(captureLineageId),
    );
    const origin =
      candidates.find((transaction) => transaction.lifecycle === "superseded") ??
      candidates[0];
    const provenance = origin?.provenanceByLineage[captureLineageId];
    if (origin === undefined || provenance === undefined) return [];
    return [
      {
        fingerprint: captureFingerprint({
          householdId: origin.householdId,
          provenance,
        }),
        transactionId: origin.transactionId,
        captureLineageId,
        state: "active" as const,
      },
    ];
  });

  return {
    transactions,
    dedupClaims,
    cancellationReceipts: [],
    legacyIncompleteLineageIds: [
      ...(fixture.legacyIncompleteLineageIds ?? []),
    ],
  };
}

export function createCaptureProvenanceCancellationDriver(
  fixture: CaptureProvenanceCancellationFixture = {},
): CaptureProvenanceCancellationDriver {
  const ledger = new InMemoryCaptureProvenanceLedger(initialState(fixture));
  const application = createCaptureProvenanceCancellationApplication(ledger);
  return {
    captureApproval: (input) => application.captureApproval(input),
    cancel: ({ commitOutcome, ...input }) => {
      if (commitOutcome === "failure") ledger.failCommitOnce();
      return application.cancel(input);
    },
    availableUserCommands: () => application.availableUserCommands(),
    state: () => ledger.state(),
  };
}
