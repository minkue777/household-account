import { createHash } from "node:crypto";

import { FieldValue, type Firestore } from "firebase-admin/firestore";

import type { ShortcutRejectedMessageDiagnosticPort } from "../../../contexts/payment-capture/shortcut-ingestion/application/ports/out/shortcutHttpInboundPorts";

const COLLECTION = "notification_debug_logs";

function diagnosticId(input: {
  readonly credentialIdHash: string;
  readonly rawMessage: string;
}): string {
  const rawMessageHash = createHash("sha256")
    .update(input.rawMessage, "utf8")
    .digest("hex");
  return createHash("sha256")
    .update(
      `ios-shortcut-parser-rejection\u0000${input.credentialIdHash}\u0000${rawMessageHash}`,
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
 * Parser 개선 기간에만 사용하는 서버 전용 원문 저장 Adapter입니다.
 * 같은 credential·payload는 한 문서로 합치고 Cloud Logging에는 원문을 남기지 않습니다.
 */
export class FirebaseShortcutRejectedMessageDiagnosticAdapter
  implements ShortcutRejectedMessageDiagnosticPort
{
  constructor(private readonly database: Firestore) {}

  async retain(
    input: Parameters<ShortcutRejectedMessageDiagnosticPort["retain"]>[0],
  ): Promise<void> {
    await this.database
      .collection(COLLECTION)
      .doc(diagnosticId(input))
      .set(
        {
          diagnosticType: "ios-shortcut-parser-rejection",
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
          parserRejectionCode: input.rejectionCode,
          credentialIdHash: `sha256:${input.credentialIdHash}`,
          payloadHash: `sha256:${input.payloadHash}`,
          rawMessageLength: input.rawMessage.length,
          normalizedMessageLength: input.normalizedMessage.length,
          postedAtMillis: Date.parse(input.requestedAt),
          observedAt: new Date(input.requestedAt),
          collectedAt: new Date().toISOString(),
          requestedAt: input.requestedAt,
          schemaVersion: 1,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  }
}
