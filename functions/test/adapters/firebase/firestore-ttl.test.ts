import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import {
  firestoreTtlAfter,
  firestoreInstantAsIso,
  firestoreTtlMergeField,
  firestoreTtlTimestamp,
} from "../../../src/adapters/firebase/shared/firestoreTtl";

describe("Firestore TTL serialization", () => {
  it("ISO instant를 Date and time 타입인 Timestamp로 저장한다", () => {
    const value = firestoreTtlTimestamp("2026-08-18T09:00:00.000Z");

    expect(value).toBeInstanceOf(Timestamp);
    expect(value.toDate().toISOString()).toBe("2026-08-18T09:00:00.000Z");
  });

  it("terminal 기준 시각에서 30일 뒤를 공통 보존 만료 시각으로 계산한다", () => {
    expect(
      firestoreTtlAfter("2026-07-19T09:00:00.000Z").toDate().toISOString(),
    ).toBe("2026-08-18T09:00:00.000Z");
  });

  it("Timestamp와 전환 기간의 legacy ISO string을 같은 Domain instant로 읽는다", () => {
    const timestamp = Timestamp.fromDate(new Date("2026-08-18T09:00:00.000Z"));

    expect(firestoreInstantAsIso(timestamp)).toBe("2026-08-18T09:00:00.000Z");
    expect(firestoreInstantAsIso("2026-08-18T09:00:00.000Z")).toBe(
      "2026-08-18T09:00:00.000Z",
    );
  });

  it("재활성화 merge는 과거 TTL을 명시적으로 제거한다", () => {
    expect(firestoreTtlMergeField(undefined).expiresAt).toBeInstanceOf(FieldValue);
  });

  it("잘못된 instant를 영구 보존으로 조용히 바꾸지 않는다", () => {
    expect(() => firestoreTtlTimestamp("not-a-date")).toThrow(
      "FIRESTORE_INSTANT_INVALID",
    );
    expect(() => firestoreInstantAsIso({ seconds: 1 })).toThrow(
      "FIRESTORE_INSTANT_INVALID",
    );
  });
});
