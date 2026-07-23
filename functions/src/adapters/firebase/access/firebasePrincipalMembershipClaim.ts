import { createHash } from "node:crypto";

/**
 * Firebase Auth principal과 전역 Membership claim을 연결하는 공개되지 않은
 * 안정 ID입니다. 원문 UID는 문서 경로와 로그에 노출하지 않습니다.
 */
export function principalClaimId(principalUid: string): string {
  return createHash("sha256").update(principalUid, "utf8").digest("hex");
}
