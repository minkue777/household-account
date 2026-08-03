import { createHash } from "node:crypto";

import { FieldValue, type Firestore } from "firebase-admin/firestore";

import type { ShortcutMessageDiagnosticPort } from "../../../contexts/payment-capture/shortcut-ingestion/application/ports/out/shortcutHttpInboundPorts";

const COLLECTION = "notification_debug_logs";

type DiagnosticInput = Parameters<ShortcutMessageDiagnosticPort["retain"]>[0];

function diagnosticId(input: DiagnosticInput): string {
  const rawMessageHash = createHash("sha256")
    .update(input.rawMessage, "utf8")
    .digest("hex");
  const outcomeKey =
    input.parserOutcome.kind === "accepted" ? "accepted" : "rejection";
  return createHash("sha256")
    .update(
      `ios-shortcut-parser-${outcomeKey}\u0000${input.credentialIdHash}\u0000${rawMessageHash}`,
      "utf8",
    )
    .digest("hex");
}

function diagnosticLines(value: string): readonly string[] {
  return value
    .split(/\r\n|[\n\r\u2028\u2029]/u)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * 인증된 iPhone Shortcut 원문을 파서 개선 기간에만 보존하는 서버 전용 Adapter입니다.
 */
export class FirebaseShortcutMessageDiagnosticAdapter
  implements ShortcutMessageDiagnosticPort
{
  constructor(private readonly database: Firestore) {}

  async retain(input: DiagnosticInput): Promise<void> {
    const accepted = input.parserOutcome.kind === "accepted";
    await this.database
      .collection(COLLECTION)
      .doc(diagnosticId(input))
      .set(
        {
          diagnosticType: accepted
            ? "ios-shortcut-parser-accepted"
            : "ios-shortcut-parser-rejection",
          parserOutcome: input.parserOutcome.kind,
          ...(input.parserOutcome.kind === "rejected"
            ? { parserRejectionCode: input.parserOutcome.code }
            : {}),
          householdId: input.actor.householdId,
          memberId: input.actor.actingMemberId,
          packageName: "ios-shortcut",
          source: "ios-shortcut",
          sourceType: "ios-shortcut",
          title: "",
          text: input.normalizedMessage,
          bigText: "",
          textLines: diagnosticLines(input.normalizedMessage),
          fullText: input.rawMessage,
          normalizedText: input.normalizedMessage,
          credentialIdHash: `sha256:${input.credentialIdHash}`,
          payloadHash: `sha256:${input.payloadHash}`,
          rawMessageLength: input.rawMessage.length,
          normalizedMessageLength: input.normalizedMessage.length,
          postedAtMillis: Date.parse(input.requestedAt),
          observedAt: new Date(input.requestedAt),
          collectedAt: new Date().toISOString(),
          requestedAt: input.requestedAt,
          schemaVersion: 2,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  }
}
