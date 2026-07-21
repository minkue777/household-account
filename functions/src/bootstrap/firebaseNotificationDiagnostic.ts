import * as functions from "firebase-functions/v1";

import { FirebaseDiagnosticDocumentStore } from "../adapters/firebase/payment-capture/firebaseDiagnosticDocumentStore";
import {
  NotificationDiagnosticValidationError,
  decodeNotificationDiagnostic,
  type NotificationDiagnosticWireInput,
} from "../adapters/firebase/payment-capture/notificationDiagnosticDecoder";
import {
  FirebaseCaptureMembershipResolver,
  type CaptureMembershipResolver,
} from "../adapters/firebase/payment-capture/firebaseCaptureMembershipResolver";
import { createDiagnosticRetentionApplication } from "../contexts/payment-capture/android-payment-ingestion/application/diagnosticRetentionApplication";
import type {
  DiagnosticCollectionResult,
  DiagnosticRetentionInputPort,
} from "../contexts/payment-capture/android-payment-ingestion/application/ports/in/diagnosticRetentionInputPort";
import {
  resolveRegisteredDiagnosticSource,
  type RegisteredDiagnosticSource,
} from "../contexts/payment-capture/android-payment-ingestion/domain/policies/resolveDiagnosticSource";
import { db, REGION } from "../config";

export type NotificationDiagnosticCallableErrorCode =
  | "unauthenticated"
  | "permission-denied"
  | "invalid-argument"
  | "internal";

export class NotificationDiagnosticCallableRejection extends Error {
  constructor(
    readonly callableCode: NotificationDiagnosticCallableErrorCode,
    readonly domainCode: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(domainCode);
    this.name = "NotificationDiagnosticCallableRejection";
  }
}

export interface NotificationDiagnosticWireResponse {
  readonly contractVersion: "notification-diagnostic-response.v1";
  readonly result: DiagnosticCollectionResult;
}

export interface NotificationDiagnosticCallableHandler {
  handle(input: {
    readonly principalUid?: string;
    readonly data: unknown;
  }): Promise<NotificationDiagnosticWireResponse>;
}

export function createNotificationDiagnosticCallableHandler(input: {
  readonly memberships: CaptureMembershipResolver;
  readonly diagnostics: DiagnosticRetentionInputPort;
  readonly now?: () => string;
  readonly decode?: (data: unknown) => NotificationDiagnosticWireInput;
  readonly resolveSource?: (
    candidate: NotificationDiagnosticWireInput,
  ) => RegisteredDiagnosticSource | undefined;
}): NotificationDiagnosticCallableHandler {
  return {
    async handle(request): Promise<NotificationDiagnosticWireResponse> {
      const membership = await input.memberships.resolve(request.principalUid);
      if (membership.kind === "unauthenticated") {
        throw new NotificationDiagnosticCallableRejection(
          "unauthenticated",
          membership.code,
        );
      }
      if (membership.kind === "forbidden") {
        throw new NotificationDiagnosticCallableRejection(
          "permission-denied",
          membership.code,
        );
      }

      let diagnostic: NotificationDiagnosticWireInput;
      try {
        diagnostic = (input.decode ?? decodeNotificationDiagnostic)(request.data);
      } catch (error) {
        if (error instanceof NotificationDiagnosticValidationError) {
          throw new NotificationDiagnosticCallableRejection(
            "invalid-argument",
            error.code,
            { path: error.path },
          );
        }
        throw error;
      }

      const source = (input.resolveSource ?? resolveRegisteredDiagnosticSource)(
        diagnostic,
      );
      const result = await input.diagnostics.collect({
        actor: {
          householdId: membership.householdId,
          memberId: membership.memberId,
          role: "member",
        },
        sourceRegistered: source !== undefined,
        notification: {
          packageName: diagnostic.packageName,
          sourceType: source?.sourceType ?? "",
          title: diagnostic.title,
          text: diagnostic.text,
          bigText: diagnostic.bigText,
          textLines: [...diagnostic.textLines],
          fullText: diagnostic.fullText,
          postedAtMillis: diagnostic.postedAtMillis,
          collectedAt: (input.now ?? (() => new Date().toISOString()))(),
        },
        // 진단 저장은 결제 처리와 독립된 best-effort 경로입니다.
        businessOutcome: "Ignored",
      });
      return {
        contractVersion: "notification-diagnostic-response.v1",
        result,
      };
    },
  };
}

const diagnosticHandler = createNotificationDiagnosticCallableHandler({
  memberships: new FirebaseCaptureMembershipResolver(db),
  diagnostics: createDiagnosticRetentionApplication(
    new FirebaseDiagnosticDocumentStore(db),
  ),
});

export const submitNotificationDiagnostic = functions
  .region(REGION)
  .runWith({ enforceAppCheck: true })
  .https.onCall(
    async (data, context): Promise<NotificationDiagnosticWireResponse> => {
      try {
        return await diagnosticHandler.handle({
          ...(context.auth?.uid === undefined
            ? {}
            : { principalUid: context.auth.uid }),
          data,
        });
      } catch (error) {
        if (error instanceof NotificationDiagnosticCallableRejection) {
          throw new functions.https.HttpsError(
            error.callableCode,
            error.domainCode,
            error.details,
          );
        }
        throw new functions.https.HttpsError(
          "internal",
          "NOTIFICATION_DIAGNOSTIC_UNAVAILABLE",
        );
      }
    },
  );
