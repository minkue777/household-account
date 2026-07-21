import { describe, expect, it } from "vitest";
import {
  createSourceRegistrySelectionDriver,
  type NotificationSourceInput,
  type SourceRegistrySelectionInputPort,
  type SourceRegistryFixtureEntry,
} from "../../../support/source-registry-selection-driver";

export interface SourceRegistrySelectionSubject
  extends SourceRegistrySelectionInputPort {}

export function createSubject(
  registry: readonly SourceRegistryFixtureEntry[],
): SourceRegistrySelectionSubject {
  return createSourceRegistrySelectionDriver(registry);
}

const kbPackage = "com.kbcard.cxh.appcard";
const tossPackage = "viva.republica.toss";
const kbApprovalBody =
  "승인 12,000원\n07/19 10:00\n국민(1234)\n가맹점 A";
const tossApprovalBody =
  "8,000원 결제\n07/19 10:00\n가맹점 B";

function registryFixture(): readonly SourceRegistryFixtureEntry[] {
  return [
    {
      packageName: kbPackage,
      sourceType: "kb-card",
      registryVersion: "source-registry.v1",
      sourceState: "active",
      parserId: "kb-card-parser",
      parserVersion: "2",
      parserState: "active",
    },
    {
      packageName: tossPackage,
      sourceType: "toss",
      registryVersion: "source-registry.v1",
      sourceState: "active",
      parserId: "toss-parser",
      parserVersion: "3",
      parserState: "active",
    },
  ];
}

function notification(
  packageName: string,
  body: string,
): NotificationSourceInput {
  return {
    packageName,
    postedAt: "2026-07-19T10:00:00+09:00",
    body,
  };
}

describe("등록 결제 source와 전용 parser 선택 공개 계약", () => {
  it("[T-ING-003][ING-002][DEC-005] 등록 package는 그 package에 연결된 전용 parser 결과만 반환한다", () => {
    const result = createSubject(registryFixture()).parse(
      notification(kbPackage, kbApprovalBody),
    );

    expect(result).toEqual({
      kind: "parsed",
      source: {
        kind: "android-registered-package",
        packageName: kbPackage,
        sourceType: "kb-card",
        registryVersion: "source-registry.v1",
      },
      parser: {
        parserId: "kb-card-parser",
        parserVersion: "2",
      },
      payment: {
        observationType: "approval",
        amountInWon: 12_000,
        merchant: "가맹점 A",
      },
    });
  });

  it("[T-ING-003][ING-002][DEC-005] 등록 KB package의 본문이 다른 공급자 형식이어도 다른 parser로 fallback하지 않는다", () => {
    const result = createSubject(registryFixture()).parse(
      notification(kbPackage, tossApprovalBody),
    );

    expect(result.kind).not.toBe("parsed");
    expect(result).toMatchObject({
      code: "PARSE_FAILED",
      source: {
        kind: "android-registered-package",
        packageName: kbPackage,
        sourceType: "kb-card",
        registryVersion: "source-registry.v1",
      },
      parser: {
        parserId: "kb-card-parser",
        parserVersion: "2",
      },
    });
  });

  it("[T-ING-003][ING-002][DEC-005] 미등록 package는 지원 본문과 같아도 source·parser evidence를 만들지 않고 무시한다", () => {
    const result = createSubject(registryFixture()).parse(
      notification("com.example.unregistered", kbApprovalBody),
    );

    expect(result).toEqual({
      kind: "ignored",
      code: "UNSUPPORTED_SOURCE",
    });
    expect(result).not.toHaveProperty("source");
    expect(result).not.toHaveProperty("payment");
  });

  it.each([
    {
      name: "source가 비활성",
      override: { sourceState: "inactive" as const },
    },
    {
      name: "parser가 비활성",
      override: { parserState: "inactive" as const },
    },
  ])(
    "[T-ING-003][ING-002][DEC-005] 등록 package라도 $name 상태면 지출 후보를 만들지 않는다",
    ({ override }) => {
      const registry = registryFixture().map((entry) =>
        entry.packageName === kbPackage ? { ...entry, ...override } : entry,
      );

      const result = createSubject(registry).parse(
        notification(kbPackage, kbApprovalBody),
      );

      expect(result).toEqual({
        kind: "ignored",
        code: "UNSUPPORTED_SOURCE",
      });
      expect(result).not.toHaveProperty("source");
      expect(result).not.toHaveProperty("parser");
      expect(result).not.toHaveProperty("payment");
    },
  );

  it("[T-ING-003][ING-002] Registry 항목의 입력 순서는 package별 parser 결정에 영향을 주지 않는다", () => {
    const registry = registryFixture();
    const input = notification(kbPackage, kbApprovalBody);

    const forward = createSubject(registry).parse(input);
    const reversed = createSubject([...registry].reverse()).parse(input);

    expect(reversed).toEqual(forward);
  });
});
