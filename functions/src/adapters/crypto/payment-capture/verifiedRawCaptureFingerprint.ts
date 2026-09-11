import { createHash } from "node:crypto";

/** Only the server raw-notification ingress supplies this hash; public typed envelopes do not. */
export function verifiedRawCaptureFingerprint(input: {
  readonly householdId: string;
  readonly idempotencyKey: string;
  readonly creatorMemberId: string;
  readonly payloadHash: string;
}): string {
  const identity = JSON.stringify([
    input.householdId, input.idempotencyKey, input.creatorMemberId, input.payloadHash,
  ]);
  return `capture-raw-input.v2:${createHash("sha256").update(identity, "utf8").digest("hex")}`;
}
