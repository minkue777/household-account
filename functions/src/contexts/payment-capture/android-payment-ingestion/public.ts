import { parseCityGasBill } from "./domain/policies/parseCityGasBill";
import type { CityGasParserInputPort } from "./application/ports/in/cityGasParserInputPort";
import { createAndroidProviderParserApplication } from "./application/androidProviderParserApplication";
import type { AndroidProviderParserInputPort } from "./application/ports/in/androidProviderParserInputPort";
import { resolvePaymentOccurrenceYear } from "../intake/public";
export {
  createAndroidRawNotificationSubmissionApplication,
  type AndroidRawNotificationSubmissionDependencies,
} from "./application/androidRawNotificationSubmissionApplication";

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
  AndroidProviderParseResult,
  AndroidProviderSource,
  AndroidRawNotification,
  ParsedPaymentGolden,
  ParseAndroidProviderNotificationInput,
} from "./domain/model/androidProviderParser";

export type { AndroidProviderParserInputPort } from "./application/ports/in/androidProviderParserInputPort";

export type {
  AndroidRawNotificationInput,
  AndroidRawNotificationSubmissionInputPort,
  SubmitAndroidRawNotificationCommand,
} from "./application/ports/in/androidRawNotificationSubmissionInputPort";

export function createAndroidProviderParser(): AndroidProviderParserInputPort {
  return createAndroidProviderParserApplication({
    resolveOccurrenceYear: resolvePaymentOccurrenceYear,
  });
}

export type {
  CaptureBalanceBranch,
  CaptureBalanceBranchResult,
  CaptureBranchEnvelope,
  CaptureBranchSubmissionInputPort,
  CaptureBranchSubmissionOutcome,
  CaptureBranchSubmissionResult,
  CaptureQuickEditSnapshot,
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
