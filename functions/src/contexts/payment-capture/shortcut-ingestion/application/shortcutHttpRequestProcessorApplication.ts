import type { ShortcutHttpRequestProcessorInputPort } from "./ports/in/shortcutHttpRequestProcessorInputPort";
import type {
  ShortcutHttpCredentialAuthorizationPort,
  ShortcutHttpCredentialGatePort,
  ShortcutHttpHashPort,
  ShortcutHttpMessageParserPort,
  ShortcutHttpPaymentIntakePort,
  ShortcutHttpReceiptPort,
} from "./ports/out/shortcutHttpInboundPorts";
import type { ShortcutHttpRequestProcessingResult } from "../domain/model/shortcutHttpInbound";

export interface ShortcutHttpRequestProcessorDependencies {
  readonly credentials: ShortcutHttpCredentialAuthorizationPort;
  readonly credentialGate: ShortcutHttpCredentialGatePort;
  readonly parser: ShortcutHttpMessageParserPort;
  readonly intake: ShortcutHttpPaymentIntakePort;
  readonly receipts: ShortcutHttpReceiptPort;
  readonly hashes: ShortcutHttpHashPort;
}

function processingError(
  code: Extract<ShortcutHttpRequestProcessingResult, { kind: "error" }>["code"],
  retryable = false,
): ShortcutHttpRequestProcessingResult {
  return { kind: "error", code, retryable };
}

export function createShortcutHttpRequestProcessorApplication(
  dependencies: ShortcutHttpRequestProcessorDependencies,
): ShortcutHttpRequestProcessorInputPort {
  return {
    async process(input) {
      const authorization = await dependencies.credentials.authorize({
        bearerCredential: input.bearerCredential,
        requestedAt: input.requestedAt,
      });
      if (authorization.kind === "unauthenticated") {
        return processingError(authorization.code);
      }
      if (authorization.kind === "forbidden") {
        return processingError("HOUSEHOLD_FORBIDDEN");
      }

      const gate = await dependencies.credentialGate.evaluate(
        authorization.credential.credentialId,
      );
      if (gate.kind === "rate-limited") {
        return processingError("RATE_LIMITED", true);
      }
      if (gate.kind === "quota-exceeded") {
        return processingError("QUOTA_EXCEEDED", true);
      }

      const payloadHash = dependencies.hashes.hash(input.normalizedMessage);
      const logicalKey =
        input.idempotencyKey === undefined || input.idempotencyKey === ""
          ? `derived:${payloadHash}`
          : `provided:${input.idempotencyKey}`;
      const receiptKey = `${authorization.credential.credentialId}:${logicalKey}`;
      const commandId = `shortcut-command-${dependencies.hashes
        .hash(receiptKey)
        .slice(0, 24)}`;
      const claim = await dependencies.receipts.claim({ receiptKey, payloadHash });
      if (claim.kind === "payload-mismatch") {
        return processingError("IDEMPOTENCY_PAYLOAD_MISMATCH");
      }
      if (claim.kind === "completed") return claim.result;
      if (claim.kind === "in-progress") {
        return dependencies.receipts.waitForCompletion(receiptKey);
      }

      try {
        const parsed = dependencies.parser.parse({
          message: input.normalizedMessage,
          receivedAt: input.requestedAt,
          zoneId: "Asia/Seoul",
        });
        if (parsed.kind === "Rejected") {
          const result = processingError("UNSUPPORTED_MESSAGE");
          await dependencies.receipts.complete({ receiptKey, result });
          return result;
        }

        const intake = await dependencies.intake.submit({
          commandId,
          credentialId: authorization.credential.credentialId,
          payloadHash,
          requestedAt: input.requestedAt,
          actor: authorization.credential.actor,
          parsed,
        });
        let result: ShortcutHttpRequestProcessingResult;
        if (intake.kind === "retryable-failure") {
          result = processingError(
            "PAYMENT_INTAKE_TEMPORARILY_UNAVAILABLE",
            true,
          );
          await dependencies.receipts.abandon({ receiptKey, result });
          return result;
        }
        if (intake.kind === "rejected") {
          result = processingError(intake.code);
        } else {
          result = {
            kind: "success",
            commandId,
            transaction:
              intake.kind === "created"
                ? { kind: "created", transactionId: intake.transactionId }
                : {
                    kind: "duplicate",
                    existingTransactionId: intake.existingTransactionId,
                  },
            notification: {
              state: "queued",
              targetMemberId: authorization.credential.actor.actingMemberId,
            },
          };
        }
        await dependencies.receipts.complete({ receiptKey, result });
        return result;
      } catch (error) {
        await dependencies.receipts.abandon({ receiptKey });
        throw error;
      }
    },
  };
}
