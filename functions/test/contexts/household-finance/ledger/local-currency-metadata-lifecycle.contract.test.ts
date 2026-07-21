import { describe, expect, it } from "vitest";
import { createLocalCurrencyMetadataFixtureSubject } from "../../../support/local-currency-metadata-fixture";

export interface LocalCurrencyMetadataTransaction {
  transactionId: string;
  householdId: string;
  merchant: string;
  amountInWon: number;
  localCurrencyType?: string;
  captureLineageId?: string;
  aggregateVersion: number;
}

export type LocalCurrencyMetadataResult =
  | { kind: "Recorded"; transaction: LocalCurrencyMetadataTransaction }
  | { kind: "Updated"; transaction: LocalCurrencyMetadataTransaction }
  | {
      kind: "ValidationError";
      code:
        | "LOCAL_CURRENCY_TYPE_REQUIRED"
        | "LOCAL_CURRENCY_TYPE_NOT_CAPTURE_VERIFIED"
        | "LOCAL_CURRENCY_TYPE_IMMUTABLE";
    }
  | { kind: "Conflict"; code: "VERSION_MISMATCH" }
  | { kind: "NotFound" };

export interface LocalCurrencyMetadataContractSubject {
  recordCaptured(input: {
    actor: { householdId: string; memberId: string };
    commandId: string;
    draft: {
      merchant: string;
      amountInWon: number;
      captureLineageId: string;
      captureKind: "local-currency" | "card";
      verifiedLocalCurrencyType?: string;
    };
  }): Promise<LocalCurrencyMetadataResult>;
  recordManual(input: {
    actor: { householdId: string; memberId: string };
    commandId: string;
    merchant: string;
    amountInWon: number;
    requestedLocalCurrencyType?: string;
  }): Promise<LocalCurrencyMetadataResult>;
  update(input: {
    actor: { householdId: string; memberId: string };
    commandId: string;
    transactionId: string;
    expectedVersion: number;
    patch: { merchant?: string; localCurrencyType?: string | null };
  }): Promise<LocalCurrencyMetadataResult>;
  snapshot(): readonly LocalCurrencyMetadataTransaction[];
}

export function createSubject(fixture: {
  transactions?: readonly LocalCurrencyMetadataTransaction[];
}): LocalCurrencyMetadataContractSubject {
  return createLocalCurrencyMetadataFixtureSubject(fixture);
}

const actor = { householdId: "household-1", memberId: "member-1" };

describe("지역화폐 거래 type 생성·불변 metadata 공개 계약", () => {
  it("[T-LED-004][LED-010] 검증된 지역화폐 capture만 localCurrencyType과 lineage를 함께 저장한다", async () => {
    const subject = createSubject({});

    const result = await subject.recordCaptured({
      actor,
      commandId: "capture-gyeonggi",
      draft: {
        merchant: "지역화폐 가맹점",
        amountInWon: 12_000,
        captureLineageId: "lineage-gyeonggi",
        captureKind: "local-currency",
        verifiedLocalCurrencyType: "gyeonggi",
      },
    });

    expect(result).toMatchObject({
      kind: "Recorded",
      transaction: {
        householdId: "household-1",
        merchant: "지역화폐 가맹점",
        amountInWon: 12_000,
        localCurrencyType: "gyeonggi",
        captureLineageId: "lineage-gyeonggi",
        aggregateVersion: 1,
      },
    });
    expect(subject.snapshot()).toEqual([
      expect.objectContaining({
        localCurrencyType: "gyeonggi",
        captureLineageId: "lineage-gyeonggi",
      }),
    ]);
  });

  it("[T-LED-004][LED-010] 지역화폐 capture에 검증 type이 없으면 일반 원장으로 임의 생성하지 않는다", async () => {
    const subject = createSubject({});

    expect(
      await subject.recordCaptured({
        actor,
        commandId: "missing-type",
        draft: {
          merchant: "지역화폐 가맹점",
          amountInWon: 12_000,
          captureLineageId: "lineage-missing",
          captureKind: "local-currency",
        },
      }),
    ).toEqual({
      kind: "ValidationError",
      code: "LOCAL_CURRENCY_TYPE_REQUIRED",
    });
    expect(subject.snapshot()).toEqual([]);
  });

  it("[T-LED-004][LED-010] 수동 입력이 localCurrencyType을 주장해도 검증 capture로 간주하지 않는다", async () => {
    const subject = createSubject({});

    expect(
      await subject.recordManual({
        actor,
        commandId: "manual-forged-type",
        merchant: "수동 거래",
        amountInWon: 10_000,
        requestedLocalCurrencyType: "gyeonggi",
      }),
    ).toEqual({
      kind: "ValidationError",
      code: "LOCAL_CURRENCY_TYPE_NOT_CAPTURE_VERIFIED",
    });
    expect(subject.snapshot()).toEqual([]);
  });

  it("[T-LED-004][LED-010] 일반 표시 필드 수정은 type을 유지하고 type 변경·제거 시도는 무변경 거부한다", async () => {
    const original: LocalCurrencyMetadataTransaction = {
      transactionId: "transaction-gyeonggi",
      householdId: "household-1",
      merchant: "이전 가맹점",
      amountInWon: 10_000,
      localCurrencyType: "gyeonggi",
      captureLineageId: "lineage-gyeonggi",
      aggregateVersion: 2,
    };
    const subject = createSubject({ transactions: [original] });

    expect(
      await subject.update({
        actor,
        commandId: "update-merchant",
        transactionId: "transaction-gyeonggi",
        expectedVersion: 2,
        patch: { merchant: "새 가맹점" },
      }),
    ).toEqual({
      kind: "Updated",
      transaction: {
        ...original,
        merchant: "새 가맹점",
        aggregateVersion: 3,
      },
    });
    const afterAllowed = subject.snapshot();

    for (const localCurrencyType of ["daejeon", null] as const) {
      expect(
        await subject.update({
          actor,
          commandId: `forbidden-type-${localCurrencyType ?? "remove"}`,
          transactionId: "transaction-gyeonggi",
          expectedVersion: 3,
          patch: { localCurrencyType },
        }),
      ).toEqual({
        kind: "ValidationError",
        code: "LOCAL_CURRENCY_TYPE_IMMUTABLE",
      });
      expect(subject.snapshot()).toEqual(afterAllowed);
    }
  });
});
