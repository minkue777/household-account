import type {
  CaptureProvenanceAggregateState,
} from "../../../domain/model/captureProvenance";

export interface CaptureProvenanceLedgerState
  extends CaptureProvenanceAggregateState {
  readonly revision: number;
}

export interface CaptureProvenanceLedgerPort {
  load(): CaptureProvenanceLedgerState;
  nextRestoredTransactionId(): string;
  commit(
    expectedRevision: number,
    nextState: CaptureProvenanceAggregateState,
  ): "committed" | "failed";
}
