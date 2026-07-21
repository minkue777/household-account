import { describe, expect, it } from "vitest";

import { createWireDtoFixture } from "../../../support/wire-dto-fixture";

export type AndroidWireDto =
  | {
      contractVersion: "bridge.v1";
      requestId: string;
      operation:
        | { kind: "GET_APP_VERSION" }
        | { kind: "SYNC_SESSION_MIRROR"; membershipReceiptId: string };
    }
  | {
      contractVersion: "quick-edit-snapshot.v1";
      transactionId: string;
      merchant: string;
      amountInWon: number;
      categoryId: string | null;
      memo: string | null;
      aggregateVersion: number | null;
    };

export type AndroidWireRoundTripResult =
  | {
      kind: "Decoded";
      kotlinType: "BridgeRequestV1" | "QuickEditSnapshotV1";
      reencodedJson: string;
    }
  | {
      kind: "Rejected";
      code: "VERSION_UNSUPPORTED" | "SCHEMA_INVALID";
    };

export interface AndroidWireDtoConformanceContractSubject {
  decodeInGeneratedKotlinAndReencode(json: string): AndroidWireRoundTripResult;
}

export function createSubject(): AndroidWireDtoConformanceContractSubject {
  return createWireDtoFixture();
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
};

const canonicalJson = (value: unknown): string => JSON.stringify(canonicalize(value));

describe("Android Kotlin·TypeScript wire DTO 양방향 공개 계약", () => {
  it.each<{
    name: string;
    dto: AndroidWireDto;
    kotlinType: "BridgeRequestV1" | "QuickEditSnapshotV1";
  }>([
    {
      name: "Principal-bound Membership receipt Bridge 요청",
      dto: {
        contractVersion: "bridge.v1",
        requestId: "request-1",
        operation: {
          kind: "SYNC_SESSION_MIRROR",
          membershipReceiptId: "membership-receipt-1",
        },
      },
      kotlinType: "BridgeRequestV1",
    },
    {
      name: "nullable 표시 필드를 가진 QuickEdit snapshot",
      dto: {
        contractVersion: "quick-edit-snapshot.v1",
        transactionId: "transaction-1",
        merchant: "가맹점",
        amountInWon: 10_001,
        categoryId: null,
        memo: null,
        aggregateVersion: 7,
      },
      kotlinType: "QuickEditSnapshotV1",
    },
  ])(
    "[T-ANDROID-WIRE-001][AND-005/AND-006/QE-002] $name은 generated Kotlin codec 왕복에서 필드 의미를 잃지 않는다",
    ({ dto, kotlinType }) => {
      const result = createSubject().decodeInGeneratedKotlinAndReencode(
        JSON.stringify(dto),
      );

      expect(result.kind).toBe("Decoded");
      if (result.kind === "Decoded") {
        expect(result.kotlinType).toBe(kotlinType);
        expect(canonicalJson(JSON.parse(result.reencodedJson))).toBe(
          canonicalJson(dto),
        );
      }
    },
  );

  it.each([
    {
      contractVersion: "bridge.v2",
      requestId: "request-unknown-version",
      operation: { kind: "GET_APP_VERSION" },
    },
    {
      contractVersion: "quick-edit-snapshot.v1",
      transactionId: "transaction-1",
      merchant: "가맹점",
      amountInWon: 1.5,
      categoryId: null,
      memo: null,
      aggregateVersion: 7,
    },
  ])(
    "[T-ANDROID-WIRE-001] 알 수 없는 version이나 원 단위 정수가 아닌 wire 값은 Kotlin default로 추정하지 않는다",
    (invalidDto) => {
      expect(
        createSubject().decodeInGeneratedKotlinAndReencode(
          JSON.stringify(invalidDto),
        ),
      ).toMatchObject({ kind: "Rejected" });
    },
  );

  it.each<{
    name: string;
    dto: AndroidWireDto;
    kotlinType: "BridgeRequestV1" | "QuickEditSnapshotV1";
  }>([
    {
      name: "payload가 없는 앱 버전 Bridge 요청",
      dto: {
        contractVersion: "bridge.v1",
        requestId: "request-version",
        operation: { kind: "GET_APP_VERSION" },
      },
      kotlinType: "BridgeRequestV1",
    },
    {
      name: "아직 aggregate version이 없는 QuickEdit snapshot",
      dto: {
        contractVersion: "quick-edit-snapshot.v1",
        transactionId: "transaction-new",
        merchant: "신규 가맹점",
        amountInWon: 1,
        categoryId: "category-food",
        memo: "",
        aggregateVersion: null,
      },
      kotlinType: "QuickEditSnapshotV1",
    },
  ])("$name도 null·union 의미를 보존한다", ({ dto, kotlinType }) => {
    const result = createSubject().decodeInGeneratedKotlinAndReencode(
      JSON.stringify(dto),
    );

    expect(result.kind).toBe("Decoded");
    if (result.kind === "Decoded") {
      expect(result.kotlinType).toBe(kotlinType);
      expect(canonicalJson(JSON.parse(result.reencodedJson))).toBe(
        canonicalJson(dto),
      );
    }
  });

  it.each([
    { name: "문법 오류 JSON", json: "{not-json" },
    {
      name: "알 수 없는 Bridge operation",
      json: JSON.stringify({
        contractVersion: "bridge.v1",
        requestId: "request-1",
        operation: { kind: "DELETE_EVERYTHING" },
      }),
    },
    {
      name: "receipt가 빈 session 동기화 요청",
      json: JSON.stringify({
        contractVersion: "bridge.v1",
        requestId: "request-1",
        operation: {
          kind: "SYNC_SESSION_MIRROR",
          membershipReceiptId: "",
        },
      }),
    },
    {
      name: "정의되지 않은 필드를 포함한 snapshot",
      json: JSON.stringify({
        contractVersion: "quick-edit-snapshot.v1",
        transactionId: "transaction-1",
        merchant: "가맹점",
        amountInWon: 1_000,
        categoryId: null,
        memo: null,
        aggregateVersion: 1,
        hiddenField: "must-not-be-silently-lost",
      }),
    },
  ])("$name은 default 값으로 추정하지 않고 schema 오류로 거부한다", ({ json }) => {
    expect(createSubject().decodeInGeneratedKotlinAndReencode(json)).toEqual({
      kind: "Rejected",
      code: "SCHEMA_INVALID",
    });
  });
});
