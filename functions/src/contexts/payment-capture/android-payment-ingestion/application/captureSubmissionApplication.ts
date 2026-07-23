import type { TenantAuthorizationInputPort } from "../../../access/public";
import type {
  CaptureBalanceBranchResult,
  CaptureBranchEnvelope,
  CaptureBranchSubmissionInputPort,
  CaptureTransactionBranchResult,
} from "./ports/in/captureBranchSubmissionInputPort";
import type {
  CaptureSourceEvidence,
  CaptureSubmissionCommand,
  CaptureSubmissionInputPort,
  CaptureSubmissionOutcome,
  CaptureSubmittedBalanceResult,
  CaptureSubmittedTransactionResult,
} from "./ports/in/captureSubmissionInputPort";
import { authorizeCaptureSubmission } from "./captureSubmissionAuthorization";

export interface CaptureSubmissionDependencies {
  readonly tenantAuthorization: TenantAuthorizationInputPort;
  readonly branches: CaptureBranchSubmissionInputPort;
}

function sourceIdentity(source: CaptureSourceEvidence): string {
  return source.kind === "android-registered-package"
    ? JSON.stringify([
        source.kind,
        source.sourceType,
        source.packageName,
        source.registryVersion,
      ])
    : JSON.stringify([
        source.kind,
        source.sourceType,
        source.credentialIdHash,
      ]);
}

function seoulDate(instant: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

function branchEnvelope(
  command: CaptureSubmissionCommand,
  householdId: string,
  creatorMemberId: string,
): CaptureBranchEnvelope {
  const envelope = command.envelope;
  const payment = envelope.paymentObservation;
  const occurredAt =
    payment?.occurredLocalDate !== undefined &&
    payment.occurredLocalTime !== undefined
      ? `${payment.occurredLocalDate}T${payment.occurredLocalTime}:00+09:00`
      : envelope.observedAt;

  return {
    rootIdempotencyKey: command.rootIdempotencyKey,
    householdId,
    captureEnvelopeIdentity: {
      contractVersion: envelope.contractVersion,
      observationId: envelope.observationId,
      originChannel: envelope.originChannel,
      sourceIdentity: sourceIdentity(envelope.sourceEvidence),
      observedAt: envelope.observedAt,
      parserId: envelope.parser.parserId,
      parserVersion: envelope.parser.parserVersion,
      rawPayloadHash: envelope.rawPayloadHash,
    },
    ...(payment === undefined
      ? {}
      : {
          transactionBranch: {
            branchKey: payment.branchId,
            merchant: payment.merchantEvidence.rawCandidate,
            amountInWon: payment.amountInWon,
            occurredAt,
            accountingDate:
              payment.dueDate ??
              payment.occurredLocalDate ??
              seoulDate(envelope.observedAt),
            sourceType: envelope.sourceEvidence.sourceType,
            parser: envelope.parser,
            rawPayloadHash: envelope.rawPayloadHash,
            ...(payment.localCurrencyType === undefined
              ? {}
              : { localCurrencyType: payment.localCurrencyType }),
            captureContext: {
              observationId: envelope.observationId,
              observationType: payment.observationType,
              originChannel: envelope.originChannel,
              creatorMemberId,
              ...(payment.cardEvidence === undefined
                ? {}
                : { cardEvidence: payment.cardEvidence }),
            },
          },
        }),
    ...(envelope.balanceObservation === undefined
      ? {}
      : {
          balanceBranch: {
            branchKey: envelope.balanceObservation.branchId,
            observation: {
              contractVersion: "balance-observation.v1" as const,
              observationId: envelope.balanceObservation.branchId,
              localCurrencyType: envelope.balanceObservation.currencyType,
              balanceInWon: envelope.balanceObservation.balanceInWon,
              observedAt: envelope.balanceObservation.observedAt,
              sourceType: envelope.sourceEvidence.sourceType,
              parser: envelope.parser,
              rawPayloadHash: envelope.rawPayloadHash,
            },
          },
        }),
  };
}

export function toCaptureSubmittedTransactionResult(
  result: CaptureTransactionBranchResult,
): CaptureSubmittedTransactionResult {
  switch (result.kind) {
    case "recorded":
      return {
        kind: "created",
        transactionId: result.transactionId,
        editable: result.editable,
        captureLineageId: result.captureLineageId,
        aggregateVersion: result.aggregateVersion,
        ...(result.quickEditSnapshot === undefined
          ? {}
          : { quickEditSnapshot: result.quickEditSnapshot }),
      };
    case "duplicate":
    case "cancelled":
    case "needsConfirmation":
    case "notFound":
      return result;
    case "rejected":
      return { kind: "rejected", code: result.code };
    case "retryable-failure":
      return { kind: "retryableFailure", code: result.code };
  }
}

export function toCaptureSubmittedBalanceResult(
  result: CaptureBalanceBranchResult,
): CaptureSubmittedBalanceResult {
  return result.kind === "retryable-failure"
    ? { kind: "retryableFailure", code: result.code }
    : result;
}

class DefaultCaptureSubmissionApplication implements CaptureSubmissionInputPort {
  constructor(private readonly dependencies: CaptureSubmissionDependencies) {}

  async submit(
    command: CaptureSubmissionCommand,
  ): Promise<CaptureSubmissionOutcome> {
    const authorization = authorizeCaptureSubmission({
      tenantAuthorization: this.dependencies.tenantAuthorization,
      actor: command.actor,
      envelopeHouseholdId: command.actor.householdId,
    });
    if (authorization.kind !== "Authorized") return authorization;

    const result = await this.dependencies.branches.submit(
      branchEnvelope(
        command,
        authorization.householdId,
        authorization.creatorMemberId,
      ),
    );
    if (result.kind === "conflict") return result;

    return {
      kind: "success",
      value: {
        observationId: command.envelope.observationId,
        ...(result.transactionResult === undefined
          ? {}
          : {
              transactionResult: toCaptureSubmittedTransactionResult(
                result.transactionResult,
              ),
            }),
        ...(result.balanceResult === undefined
          ? {}
          : {
              balanceResult: toCaptureSubmittedBalanceResult(
                result.balanceResult,
              ),
            }),
        completion: result.completion,
      },
    };
  }
}

export function createCaptureSubmissionApplication(
  dependencies: CaptureSubmissionDependencies,
): CaptureSubmissionInputPort {
  return new DefaultCaptureSubmissionApplication(dependencies);
}
