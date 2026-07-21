import type {
  DividendCorrectionResult,
  DividendSweepReceipt,
  DividendSweepResult,
  RecoverEligibilityResult,
  SweepDividendChangedEvent,
  SweepDividendEventView,
} from "../../../domain/model/dividendSweepRecovery";

export interface DividendSweepRecovery {
  recoverEligibility(eventId: string): Promise<RecoverEligibilityResult>;
  runLifecycleSweep(input: {
    occurrenceId: string;
    asOfDate: string;
    resumeFromCheckpoint?: string;
  }): Promise<DividendSweepResult>;
  applyUnpaidCorrection(command: {
    commandId: string;
    idempotencyKey: string;
    eventId: string;
    sourceDisclosureId: string;
    recordDate: string;
    paymentDate: string;
    perShareAmountInWon: number;
  }): Promise<DividendCorrectionResult>;
  getEvent(eventId: string): Promise<SweepDividendEventView | undefined>;
  listEvents(): Promise<readonly SweepDividendEventView[]>;
  receipts(): readonly DividendSweepReceipt[];
  recordedEvents(): readonly SweepDividendChangedEvent[];
}
