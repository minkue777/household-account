import { describe, expect, it } from "vitest";
import { createItemSplitRestorationFixtureSubject } from "../../../support/item-split-restoration-fixture";

export interface ItemSplitTransaction {
  transactionId: string;
  householdId: string;
  lifecycleState: "active" | "superseded";
  merchant: string;
  amountInWon: number;
  categoryId: string;
  memo: string;
  source: string;
  originChannel: string;
  creatorMemberId: string;
  cardEvidence: string;
  captureLineageId: string;
  aggregateVersion: number;
  derivedFromTransactionId?: string;
}

export type ItemSplitResult =
  | { kind: "Split"; sourceId: string; derivedIds: readonly string[] }
  | { kind: "Restored"; transactionId: string }
  | {
      kind: "ValidationError";
      code:
        | "ITEM_SPLIT_REQUIRES_AT_LEAST_TWO_ITEMS"
        | "ITEM_AMOUNT_NOT_POSITIVE_INTEGER"
        | "SPLIT_SUM_MISMATCH";
    }
  | { kind: "Conflict"; code: "VERSION_MISMATCH" }
  | { kind: "RetryableFailure"; code: string };

export interface ItemSplitSnapshot {
  transactions: readonly ItemSplitTransaction[];
  dedupClaims: readonly {
    fingerprint: string;
    captureLineageId: string;
    state: "active" | "cancelled";
  }[];
}

export interface ItemSplitRestorationContractSubject {
  split(input: {
    actor: { householdId: string; memberId: string };
    operationKey: string;
    sourceId: string;
    expectedVersion: number;
    items: readonly {
      merchant: string;
      amountInWon: number;
      categoryId: string;
      memo: string;
    }[];
  }): Promise<ItemSplitResult>;
  restore(input: {
    actor: { householdId: string; memberId: string };
    operationKey: string;
    sourceId: string;
    expectedVersions: Readonly<Record<string, number>>;
  }): Promise<ItemSplitResult>;
  snapshot(): ItemSplitSnapshot;
}

export function createSubject(
  fixture: ItemSplitSnapshot,
): ItemSplitRestorationContractSubject {
  return createItemSplitRestorationFixtureSubject(fixture);
}

const original: ItemSplitTransaction = {
  transactionId: "original",
  householdId: "household-1",
  lifecycleState: "active",
  merchant: "원본 가맹점",
  amountInWon: 10_000,
  categoryId: "category-original",
  memo: "원본 메모",
  source: "android-notification",
  originChannel: "android",
  creatorMemberId: "member-1",
  cardEvidence: "KB:1234",
  captureLineageId: "lineage-1",
  aggregateVersion: 1,
};

const initial: ItemSplitSnapshot = {
  transactions: [original],
  dedupClaims: [
    {
      fingerprint: "fingerprint-1",
      captureLineageId: "lineage-1",
      state: "active",
    },
  ],
};

const actor = { householdId: "household-1", memberId: "member-1" };

describe("Ledger 항목 분할 검증·원복 공개 계약", () => {
  it.each([
    {
      items: [
        {
          merchant: "하나",
          amountInWon: 10_000,
          categoryId: "category-a",
          memo: "",
        },
      ],
      code: "ITEM_SPLIT_REQUIRES_AT_LEAST_TWO_ITEMS" as const,
    },
    {
      items: [
        { merchant: "A", amountInWon: 0, categoryId: "category-a", memo: "" },
        {
          merchant: "B",
          amountInWon: 10_000,
          categoryId: "category-b",
          memo: "",
        },
      ],
      code: "ITEM_AMOUNT_NOT_POSITIVE_INTEGER" as const,
    },
    {
      items: [
        {
          merchant: "A",
          amountInWon: 4_000,
          categoryId: "category-a",
          memo: "",
        },
        {
          merchant: "B",
          amountInWon: 5_000,
          categoryId: "category-b",
          memo: "",
        },
      ],
      code: "SPLIT_SUM_MISMATCH" as const,
    },
  ])(
    "[T-SPL-003][SPL-001] 잘못된 항목 분할은 $code이며 원본·claim을 바꾸지 않는다",
    async ({ items, code }) => {
      const subject = createSubject(initial);

      expect(
        await subject.split({
          actor,
          operationKey: `invalid-${code}`,
          sourceId: "original",
          expectedVersion: 1,
          items,
        }),
      ).toEqual({ kind: "ValidationError", code });
      expect(subject.snapshot()).toEqual(initial);
    },
  );

  it("[T-SPL-003][SPL-001/LED-009] 성공한 항목 분할은 원본을 superseded로 보존하고 파생 항목에 불변 증거를 복사한다", async () => {
    const subject = createSubject(initial);

    const result = await subject.split({
      actor,
      operationKey: "split-valid",
      sourceId: "original",
      expectedVersion: 1,
      items: [
        {
          merchant: "식사",
          amountInWon: 4_000,
          categoryId: "category-food",
          memo: "점심",
        },
        {
          merchant: "생활",
          amountInWon: 6_000,
          categoryId: "category-life",
          memo: "생필품",
        },
      ],
    });

    expect(result).toMatchObject({ kind: "Split", sourceId: "original" });
    const state = subject.snapshot();
    expect(state.transactions.find(({ transactionId }) => transactionId === "original"))
      .toMatchObject({ lifecycleState: "superseded", aggregateVersion: 2 });
    const derived = state.transactions.filter(
      ({ derivedFromTransactionId }) => derivedFromTransactionId === "original",
    );
    expect(derived).toHaveLength(2);
    expect(
      derived.map(
        ({
          merchant,
          amountInWon,
          categoryId,
          memo,
          source,
          originChannel,
          creatorMemberId,
          cardEvidence,
          captureLineageId,
        }) => ({
          merchant,
          amountInWon,
          categoryId,
          memo,
          source,
          originChannel,
          creatorMemberId,
          cardEvidence,
          captureLineageId,
        }),
      ),
    ).toEqual([
      {
        merchant: "식사",
        amountInWon: 4_000,
        categoryId: "category-food",
        memo: "점심",
        source: original.source,
        originChannel: original.originChannel,
        creatorMemberId: original.creatorMemberId,
        cardEvidence: original.cardEvidence,
        captureLineageId: original.captureLineageId,
      },
      {
        merchant: "생활",
        amountInWon: 6_000,
        categoryId: "category-life",
        memo: "생필품",
        source: original.source,
        originChannel: original.originChannel,
        creatorMemberId: original.creatorMemberId,
        cardEvidence: original.cardEvidence,
        captureLineageId: original.captureLineageId,
      },
    ]);
    expect(state.dedupClaims).toEqual(initial.dedupClaims);
  });

  it("[T-SPL-003][SPL-001/LED-009] 항목 분할 원복은 파생 항목을 제거하고 같은 원본 ID와 원본 필드를 재활성화한다", async () => {
    const subject = createSubject(initial);
    const split = await subject.split({
      actor,
      operationKey: "split-before-restore",
      sourceId: "original",
      expectedVersion: 1,
      items: [
        { merchant: "A", amountInWon: 4_000, categoryId: "a", memo: "a" },
        { merchant: "B", amountInWon: 6_000, categoryId: "b", memo: "b" },
      ],
    });
    const derivedIds = split.kind === "Split" ? split.derivedIds : [];
    const versions = Object.fromEntries([
      ["original", 2],
      ...derivedIds.map((id) => [id, 1] as const),
    ]);

    expect(
      await subject.restore({
        actor,
        operationKey: "restore-split",
        sourceId: "original",
        expectedVersions: versions,
      }),
    ).toEqual({ kind: "Restored", transactionId: "original" });
    expect(subject.snapshot()).toEqual({
      transactions: [{ ...original, lifecycleState: "active", aggregateVersion: 3 }],
      dedupClaims: initial.dedupClaims,
    });
  });
});
