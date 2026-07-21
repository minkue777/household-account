import { FieldValue, Timestamp } from "firebase-admin/firestore";

const INVALID_FIRESTORE_INSTANT = "FIRESTORE_INSTANT_INVALID";

export const TERMINAL_RECORD_RETENTION_MILLIS =
  30 * 24 * 60 * 60 * 1_000;

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) {
    throw new Error(INVALID_FIRESTORE_INSTANT);
  }
  return value;
}

/** Domain의 ISO instant를 Firestore TTL이 인식하는 Timestamp로 변환합니다. */
export function firestoreTtlTimestamp(value: string | Date): Timestamp {
  return Timestamp.fromDate(
    validDate(value instanceof Date ? value : new Date(value)),
  );
}

/** 기준 시각으로부터 보존 기간이 지난 시각을 Firestore TTL Timestamp로 만듭니다. */
export function firestoreTtlAfter(
  value: string | Date,
  retentionMillis = TERMINAL_RECORD_RETENTION_MILLIS,
): Timestamp {
  if (!Number.isSafeInteger(retentionMillis) || retentionMillis <= 0) {
    throw new Error("FIRESTORE_TTL_RETENTION_INVALID");
  }
  const base = validDate(value instanceof Date ? value : new Date(value));
  return firestoreTtlTimestamp(new Date(base.getTime() + retentionMillis));
}

/**
 * Firestore Timestamp와 전환 기간의 legacy ISO string을 Domain ISO instant로 읽습니다.
 * 알 수 없는 타입을 조용히 무시하면 만료 정책이 영구 보존으로 바뀔 수 있으므로 실패시킵니다.
 */
export function firestoreInstantAsIso(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return validDate(new Date(value)).toISOString();
  if (value instanceof Date) return validDate(value).toISOString();
  if (value instanceof Timestamp) return validDate(value.toDate()).toISOString();
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return validDate(
      (value as { toDate(): Date }).toDate(),
    ).toISOString();
  }
  throw new Error(INVALID_FIRESTORE_INSTANT);
}

/** merge write에서 undefined는 기존 TTL 제거를 뜻합니다. */
export function firestoreTtlMergeField(
  expiresAt: string | undefined,
): { readonly expiresAt: Timestamp | FieldValue } {
  return expiresAt === undefined
    ? { expiresAt: FieldValue.delete() }
    : { expiresAt: firestoreTtlTimestamp(expiresAt) };
}
