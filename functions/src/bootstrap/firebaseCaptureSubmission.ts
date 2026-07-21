import * as functions from "firebase-functions/v1";

import { FirebaseCaptureConfigurationQuery } from "../adapters/firebase/payment-capture/firebaseCaptureConfigurationQuery";
import { FirebaseCaptureLedgerPersistence } from "../adapters/firebase/payment-capture/firebaseCaptureLedgerPersistence";
import {
  FirebaseCaptureMembershipResolver,
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
import { FirebaseLocalCurrencyBalanceStore } from "../adapters/firebase/local-currency/firebaseLocalCurrencyBalanceStore";
import { createTenantAuthorizationApplication } from "../contexts/access/tenant-authorization/application/tenantAuthorizationApplication";
import { createCaptureBranchSubmissionApplication } from "../contexts/payment-capture/android-payment-ingestion/application/captureBranchSubmissionApplication";
import { createCaptureSubmissionApplication } from "../contexts/payment-capture/android-payment-ingestion/application/captureSubmissionApplication";
import { createCaptureTransactionGatewayApplication } from "../contexts/payment-capture/android-payment-ingestion/application/captureTransactionGatewayApplication";
import type {
  CaptureEnvelopeInput,
  CaptureSubmissionInputPort,
  CaptureSubmissionResult,
} from "../contexts/payment-capture/android-payment-ingestion/application/ports/in/captureSubmissionInputPort";
import { validateAndroidCaptureSource } from "../contexts/payment-capture/android-payment-ingestion/application/validateAndroidCaptureSource";
import { createBalanceObservationIntakeApplication } from "../contexts/household-finance/local-currency/application/balanceObservationIntakeApplication";
import { createLocalCurrencyBalanceApplication } from "../contexts/household-finance/local-currency/application/localCurrencyBalanceApplication";
import { db, REGION } from "../config";

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
      const membership = await input.memberships.resolve(request.principalUid);
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
      receipts: new FirebaseCaptureSubmissionReceiptStore(db),
      payloads: new Sha256CapturePayloadFingerprint(),
      transactions: createCaptureTransactionGatewayApplication({
        configuration: new FirebaseCaptureConfigurationQuery(db),
        ledger: new FirebaseCaptureLedgerPersistence(db),
      }),
      balances: createBalanceObservationIntakeApplication({
        balances: localCurrencyBalances,
      }),
    }),
  });
}

const captureSubmissionHandler = createCaptureSubmissionCallableHandler({
  memberships: new FirebaseCaptureMembershipResolver(db),
  submissions: createFirebaseCaptureSubmissionPort(),
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
