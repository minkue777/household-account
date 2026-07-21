import { parseCityGasBill } from "./domain/policies/parseCityGasBill";
import type { CityGasParserInputPort } from "./application/ports/in/cityGasParserInputPort";
import { selectSmsParserByPriority } from "./domain/policies/selectSmsParserByPriority";
import type { SmsParserOrderInputPort } from "./application/ports/in/smsParserOrderInputPort";
import { buildNotificationEnvelope } from "./domain/policies/buildNotificationEnvelope";
import { createRecentNotificationCache } from "./domain/policies/recentNotificationCache";
import type { NotificationIngressInputPort } from "./application/ports/in/notificationIngressInputPort";
import { createAndroidProviderParserApplication } from "./application/androidProviderParserApplication";
import type { AndroidProviderParserInputPort } from "./application/ports/in/androidProviderParserInputPort";
import { resolvePaymentOccurrenceYear } from "../intake/public";

export type {
  CityGasNotificationInput,
  CityGasParseResult,
} from "./domain/model/cityGasBill";

export type {
  CityGasParserInputPort,
} from "./application/ports/in/cityGasParserInputPort";

export function createCityGasParser(): CityGasParserInputPort {
  return { parse: parseCityGasBill };
}

export type {
  SelectSmsParserInput,
  SmsParserId,
  SmsParserOrderResult,
} from "./domain/model/smsParserOrder";

export type { SmsParserOrderInputPort } from "./application/ports/in/smsParserOrderInputPort";

export function createSmsParserOrderPolicy(): SmsParserOrderInputPort {
  return { select: selectSmsParserByPriority };
}

export type {
  CaptureEnvelopeView,
  ParsedBalanceEvidence,
  ParsedCardEvidence,
  ParsedObservationClassificationResult,
  ParsedObservationInput,
  ParsedTransactionEvidence,
} from "./domain/model/parsedObservationClassification";

export type { ParsedObservationClassificationInputPort } from "./application/ports/in/parsedObservationClassificationInputPort";

export type {
  NotificationEnvelopeResult,
  NotificationEnvelopeView,
  NotificationIngressState,
  RawNotificationInput,
  RecentNotificationClaimInput,
  RecentNotificationDecision,
  RecentNotificationEntry,
} from "./domain/model/notificationIngress";

export type { NotificationIngressInputPort } from "./application/ports/in/notificationIngressInputPort";

export function createNotificationIngress(): NotificationIngressInputPort {
  const recent = createRecentNotificationCache();
  return {
    buildEnvelope: buildNotificationEnvelope,
    claimRecent: (input) => recent.claim(input),
    restartProcess: () => recent.restartProcess(),
    state: () => recent.state(),
  };
}

export type {
  AndroidProviderParseResult,
  AndroidProviderSource,
  AndroidRawNotification,
  ParsedPaymentGolden,
  ParseAndroidProviderNotificationInput,
} from "./domain/model/androidProviderParser";

export type { AndroidProviderParserInputPort } from "./application/ports/in/androidProviderParserInputPort";

export function createAndroidProviderParser(): AndroidProviderParserInputPort {
  return createAndroidProviderParserApplication({
    resolveOccurrenceYear: resolvePaymentOccurrenceYear,
  });
}

export type {
  CaptureQueueBranch,
  CaptureQueueBranchName,
  CaptureQueueDeletionReason,
  CaptureQueueEntrySnapshot,
  CaptureQueueServerBranchResult,
  CaptureQueueState,
  EnqueueCaptureObservationInput,
  EnqueueCaptureObservationResult,
  FlushCaptureQueueResult,
  TerminalCaptureQueueBranch,
} from "./domain/model/androidCaptureQueue";

export type { AndroidCaptureQueueInputPort } from "./application/ports/in/androidCaptureQueueInputPort";

export type {
  SmsCandidateSnapshot,
  SmsCaptureResult,
  SmsNotificationEnvelope,
} from "./domain/model/androidSmsCapture";

export type { AndroidSmsCandidateInputPort } from "./application/ports/in/androidSmsCandidateInputPort";

export type {
  AndroidCaptureFollowUpResult,
  AndroidTransactionBranchResult,
  FinalizeAndroidCaptureInput,
} from "./domain/model/androidCaptureFollowUp";

export type { AndroidCaptureFollowUpInputPort } from "./application/ports/in/androidCaptureFollowUpInputPort";

export type {
  NotificationSourceInput,
  ParsedPaymentEvidence,
  SelectedParserEvidence,
  SelectedSourceEvidence,
  SourceRegistrySelectionInputPort,
  SourceSelectionResult,
} from "./application/ports/in/sourceRegistrySelectionInputPort";

export type {
  CancellationCandidateFact,
  CancellationCardEvidence,
  CancellationMatchInputPort,
  CancellationMatchResult,
  CancellationObservation,
  CancellationSearchWindow,
} from "./application/ports/in/cancellationMatchInputPort";

export type {
  CancellationExecutionActor,
  CancellationExecutionInputPort,
  CancelCapturedLineageResult,
  ExecuteMatchedCancellationCommand,
} from "./application/ports/in/cancellationExecutionInputPort";

export type {
  CancellationPreparationActor,
  CancellationPreparationObservation,
  CancellationPreparationResult,
  CancellationQueryPreparationInputPort,
  PreparedCancellationCandidateQuery,
} from "./application/ports/in/cancellationQueryPreparationInputPort";

export type {
  CaptureBalanceBranch,
  CaptureBalanceBranchResult,
  CaptureBranchEnvelope,
  CaptureBranchSubmissionInputPort,
  CaptureBranchSubmissionOutcome,
  CaptureBranchSubmissionResult,
  CaptureTransactionBranch,
  CaptureTransactionBranchResult,
} from "./application/ports/in/captureBranchSubmissionInputPort";

export type {
  CaptureApprovalActor,
  CaptureAuthorizationInputPort,
  CaptureAuthorizationResult,
  SubmitCaptureApprovalInput,
} from "./application/ports/in/captureAuthorizationInputPort";

export type {
  CaptureBalanceObservation,
  CaptureEnvelopeInput,
  CaptureOriginChannel,
  CapturePaymentObservation,
  CaptureSourceEvidence,
  CaptureSubmissionCommand,
  CaptureSubmissionInputPort,
  CaptureSubmissionOutcome,
  CaptureSubmissionResult,
  CaptureSubmittedBalanceResult,
  CaptureSubmittedTransactionResult,
} from "./application/ports/in/captureSubmissionInputPort";

export type {
  ApprovalCaptureInput,
  ApprovalCaptureResult,
  CancellationEvidence,
  CaptureCancellationReceipt,
  CaptureDedupClaimView,
  CaptureProvenance,
  CaptureProvenanceState,
  CapturedTransaction,
  ProvenanceCancellationResult,
} from "./domain/model/captureProvenance";

export type {
  CancelByProvenanceInput,
  CaptureProvenanceCancellationInputPort,
} from "./application/ports/in/captureProvenanceCancellationInputPort";
