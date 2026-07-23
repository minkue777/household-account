import * as functions from "firebase-functions/v1";

import {
  CachedCaptureConfigurationQuery,
  FirebaseCaptureConfigurationQuery,
} from "../adapters/firebase/payment-capture/firebaseCaptureConfigurationQuery";
import { FirebaseCaptureLedgerPersistence } from "../adapters/firebase/payment-capture/firebaseCaptureLedgerPersistence";
import {
  FirebaseCaptureMembershipResolver,
  CachedCaptureMembershipResolver,
  type CaptureMembershipResolver,
} from "../adapters/firebase/payment-capture/firebaseCaptureMembershipResolver";
import {
  FirebaseCaptureSubmissionReceiptStore,
  Sha256CapturePayloadFingerprint,
} from "../adapters/firebase/payment-capture/firebaseCaptureSubmissionReceiptStore";
import {
  CaptureEnvelopeValidationError,
  decodeCaptureEnvelope,
} from "../adapters/firebase/payment-capture/captureEnvelopeDecoder";
import {
  AndroidRawNotificationValidationError,
  decodeAndroidRawNotification,
} from "../adapters/firebase/payment-capture/androidRawNotificationDecoder";
import { Sha256AndroidRawNotificationHasher } from "../adapters/crypto/payment-capture/sha256AndroidRawNotificationHasher";
import { FirebaseLocalCurrencyBalanceStore } from "../adapters/firebase/local-currency/firebaseLocalCurrencyBalanceStore";
import { createTenantAuthorizationApplication } from "../contexts/access/tenant-authorization/application/tenantAuthorizationApplication";
import { createCaptureBranchSubmissionApplication } from "../contexts/payment-capture/android-payment-ingestion/application/captureBranchSubmissionApplication";
import { createCaptureSubmissionApplication } from "../contexts/payment-capture/android-payment-ingestion/application/captureSubmissionApplication";
import { createCaptureTransactionGatewayApplication } from "../contexts/payment-capture/android-payment-ingestion/application/captureTransactionGatewayApplication";
import { createAndroidProviderParserApplication } from "../contexts/payment-capture/android-payment-ingestion/application/androidProviderParserApplication";
import { createAndroidRawNotificationSubmissionApplication } from "../contexts/payment-capture/android-payment-ingestion/application/androidRawNotificationSubmissionApplication";
import type {
  AndroidRawNotificationInput,
  AndroidRawNotificationSubmissionInputPort,
} from "../contexts/payment-capture/android-payment-ingestion/application/ports/in/androidRawNotificationSubmissionInputPort";
import type {
  CaptureEnvelopeInput,
  CaptureSubmissionInputPort,
  CaptureSubmissionResult,
} from "../contexts/payment-capture/android-payment-ingestion/application/ports/in/captureSubmissionInputPort";
import { validateAndroidCaptureSource } from "../contexts/payment-capture/android-payment-ingestion/application/validateAndroidCaptureSource";
import { createBalanceObservationIntakeApplication } from "../contexts/household-finance/local-currency/application/balanceObservationIntakeApplication";
import { createLocalCurrencyBalanceApplication } from "../contexts/household-finance/local-currency/application/localCurrencyBalanceApplication";
import { resolvePaymentOccurrenceYear } from "../contexts/payment-capture/intake/public";
import { db, REGION } from "../config";
import {
  correlationIdFromOpaqueValue,
  measureCurrentInteractiveLatency,
  setCurrentInteractiveLatencyOperation,
  startInteractiveLatencyInvocation,
} from "../observability/interactiveLatency";
import {
  withCaptureConfigurationLatency,
  withCapturePersistenceLatency,
  withCaptureReceiptLatency,
} from "./captureInteractiveLatency";

export type CaptureCallableErrorCode =
  | "unauthenticated"
  | "permission-denied"
  | "invalid-argument"
  | "already-exists"
  | "internal";

export class CaptureCallableRejection extends Error {
  constructor(
    readonly callableCode: CaptureCallableErrorCode,
    readonly domainCode: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(domainCode);
    this.name = "CaptureCallableRejection";
  }
}

export interface CaptureSubmissionWireResponse {
  readonly contractVersion: "capture-submission-response.v1";
  readonly result: CaptureSubmissionResult;
}

export interface CaptureSubmissionCallableHandler {
  handle(input: {
    readonly principalUid?: string;
    readonly data: unknown;
  }): Promise<CaptureSubmissionWireResponse>;
}

export interface AndroidRawNotificationCallableHandler {
  handle(input: {
    readonly principalUid?: string;
    readonly data: unknown;
  }): Promise<CaptureSubmissionWireResponse>;
}

const RAW_NOTIFICATION_CORRELATION_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function correlationIdForAndroidRawNotificationRequest(
  data: unknown,
): string | undefined {
  try {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return undefined;
    }
    const observationId = (data as Record<string, unknown>).observationId;
    return typeof observationId === "string" &&
      RAW_NOTIFICATION_CORRELATION_ID_PATTERN.test(observationId)
      ? correlationIdFromOpaqueValue(observationId)
      : undefined;
  } catch {
    return undefined;
  }
}

function responseFromOutcome(
  outcome: Awaited<ReturnType<CaptureSubmissionInputPort["submit"]>>,
): CaptureSubmissionWireResponse {
  if (outcome.kind === "conflict") {
    throw new CaptureCallableRejection("already-exists", outcome.code);
  }
  if (outcome.kind === "Unauthenticated") {
    throw new CaptureCallableRejection("unauthenticated", outcome.code);
  }
  if (outcome.kind === "Forbidden") {
    throw new CaptureCallableRejection("permission-denied", outcome.code);
  }
  return {
    contractVersion: "capture-submission-response.v1",
    result: outcome.value,
  };
}

function rejectedBySource(
  envelope: CaptureEnvelopeInput,
  code: string,
): CaptureSubmissionResult {
  return {
    observationId: envelope.observationId,
    ...(envelope.paymentObservation === undefined
      ? {}
      : { transactionResult: { kind: "rejected" as const, code } }),
    ...(envelope.balanceObservation === undefined
      ? {}
      : { balanceResult: { kind: "rejected" as const, code } }),
    completion: "terminal",
  };
}

export function createCaptureSubmissionCallableHandler(input: {
  readonly memberships: CaptureMembershipResolver;
  readonly submissions: CaptureSubmissionInputPort;
  readonly decode?: (data: unknown) => CaptureEnvelopeInput;
}): CaptureSubmissionCallableHandler {
  return {
    async handle(request): Promise<CaptureSubmissionWireResponse> {
      const membership = await measureCurrentInteractiveLatency(
        "capture-membership",
        () => input.memberships.resolve(request.principalUid),
      );
      if (membership.kind === "unauthenticated") {
        throw new CaptureCallableRejection("unauthenticated", membership.code);
      }
      if (membership.kind === "forbidden") {
        throw new CaptureCallableRejection("permission-denied", membership.code);
      }

      let envelope: CaptureEnvelopeInput;
      try {
        envelope = (input.decode ?? decodeCaptureEnvelope)(request.data);
      } catch (error) {
        if (error instanceof CaptureEnvelopeValidationError) {
          throw new CaptureCallableRejection(
            "invalid-argument",
            error.code,
            { path: error.path },
          );
        }
        throw error;
      }

      const source = validateAndroidCaptureSource(envelope);
      if (source.kind === "rejected") {
        return {
          contractVersion: "capture-submission-response.v1",
          result: rejectedBySource(envelope, source.code),
        };
      }

      const outcome = await input.submissions.submit({
        actor: {
          principalId: membership.principalUid,
          householdId: membership.householdId,
          actingMemberId: membership.memberId,
          capabilities: ["paymentCapture:submit"],
        },
        rootIdempotencyKey: envelope.observationId,
        envelope,
      });
      return responseFromOutcome(outcome);
    },
  };
}

export function createAndroidRawNotificationCallableHandler(input: {
  readonly memberships: CaptureMembershipResolver;
  readonly submissions: AndroidRawNotificationSubmissionInputPort;
  readonly decode?: (data: unknown) => AndroidRawNotificationInput;
}): AndroidRawNotificationCallableHandler {
  return {
    async handle(request): Promise<CaptureSubmissionWireResponse> {
      const membership = await measureCurrentInteractiveLatency(
        "capture-membership",
        () => input.memberships.resolve(request.principalUid),
      );
      if (membership.kind === "unauthenticated") {
        throw new CaptureCallableRejection("unauthenticated", membership.code);
      }
      if (membership.kind === "forbidden") {
        throw new CaptureCallableRejection("permission-denied", membership.code);
      }

      let raw: AndroidRawNotificationInput;
      try {
        raw = (input.decode ?? decodeAndroidRawNotification)(request.data);
      } catch (error) {
        if (error instanceof AndroidRawNotificationValidationError) {
          throw new CaptureCallableRejection("invalid-argument", error.code, {
            path: error.path,
          });
        }
        throw error;
      }

      const outcome = await measureCurrentInteractiveLatency("handler", () =>
        input.submissions.submit({
          actor: {
            principalId: membership.principalUid,
            householdId: membership.householdId,
            actingMemberId: membership.memberId,
            capabilities: ["paymentCapture:submit"],
          },
          input: raw,
        }),
      );
      return responseFromOutcome(outcome);
    },
  };
}

const tenantAuthorization = createTenantAuthorizationApplication({
  memberships: { findByPrincipalUid: async () => undefined },
});
export function createFirebaseCaptureSubmissionPort(): CaptureSubmissionInputPort {
  const localCurrencyBalances = createLocalCurrencyBalanceApplication(
    new FirebaseLocalCurrencyBalanceStore(db),
    { now: () => new Date().toISOString() },
  );
  return createCaptureSubmissionApplication({
    tenantAuthorization,
    branches: createCaptureBranchSubmissionApplication({
      receipts: withCaptureReceiptLatency(
        new FirebaseCaptureSubmissionReceiptStore(db),
      ),
      payloads: new Sha256CapturePayloadFingerprint(),
      transactions: createCaptureTransactionGatewayApplication({
        configuration: withCaptureConfigurationLatency(
          new CachedCaptureConfigurationQuery(
            new FirebaseCaptureConfigurationQuery(db),
          ),
        ),
        ledger: withCapturePersistenceLatency(
          new FirebaseCaptureLedgerPersistence(db),
        ),
      }),
      balances: createBalanceObservationIntakeApplication({
        balances: localCurrencyBalances,
      }),
    }),
  });
}

const captureMemberships = new CachedCaptureMembershipResolver(
  new FirebaseCaptureMembershipResolver(db),
);

const captureSubmissionHandler = createCaptureSubmissionCallableHandler({
  memberships: captureMemberships,
  submissions: createFirebaseCaptureSubmissionPort(),
});

const rawNotificationSubmissionHandler =
  createAndroidRawNotificationCallableHandler({
    memberships: captureMemberships,
    submissions: createAndroidRawNotificationSubmissionApplication({
      parser: createAndroidProviderParserApplication({
        resolveOccurrenceYear: resolvePaymentOccurrenceYear,
      }),
      submissions: createFirebaseCaptureSubmissionPort(),
      payloads: new Sha256AndroidRawNotificationHasher(),
      clock: { now: () => new Date().toISOString() },
    }),
  });

export const submitCaptureEnvelope = functions
  .region(REGION)
  .runWith({ enforceAppCheck: true })
  .https.onCall(async (data, context): Promise<CaptureSubmissionWireResponse> => {
    try {
      return await captureSubmissionHandler.handle({
        ...(context.auth?.uid === undefined
          ? {}
          : { principalUid: context.auth.uid }),
        data,
      });
    } catch (error) {
      if (error instanceof CaptureCallableRejection) {
        throw new functions.https.HttpsError(
          error.callableCode,
          error.domainCode,
          error.details,
        );
      }
      throw new functions.https.HttpsError(
        "internal",
        "CAPTURE_SUBMISSION_UNAVAILABLE",
      );
    }
  });

export const submitAndroidRawNotification = functions
  .region(REGION)
  .runWith({ enforceAppCheck: true })
  .https.onCall(async (data, context): Promise<CaptureSubmissionWireResponse> => {
    const latency = startInteractiveLatencyInvocation(
      "submitAndroidRawNotification",
      { correlationId: correlationIdForAndroidRawNotificationRequest(data) },
    );
    return latency.run(async () => {
      setCurrentInteractiveLatencyOperation(
        "payment-capture.submit-android-raw-notification.v1",
      );
      try {
        const response = await rawNotificationSubmissionHandler.handle({
          ...(context.auth?.uid === undefined
            ? {}
            : { principalUid: context.auth.uid }),
          data,
        });
        latency.complete("succeeded");
        return response;
      } catch (error) {
        if (error instanceof CaptureCallableRejection) {
          latency.complete("rejected");
          throw new functions.https.HttpsError(
            error.callableCode,
            error.domainCode,
            error.details,
          );
        }
        latency.complete("failed");
        throw new functions.https.HttpsError(
          "internal",
          "RAW_NOTIFICATION_SUBMISSION_UNAVAILABLE",
        );
      }
    });
  });
