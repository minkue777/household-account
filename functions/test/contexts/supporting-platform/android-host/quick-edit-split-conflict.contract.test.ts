import { describe, expect, it } from "vitest";

import { createQuickEditSplitConflictFixture } from "../../../support/quick-edit-split-conflict-fixture";

export interface QuickEditFormSnapshot {
  transactionId: string;
  merchant: string;
  amountInWon: number;
  categoryId: string;
  memo: string;
  expectedVersion: number;
}

export interface QuickEditSplitItem {
  amountInWon: number;
  merchant: string;
  categoryId: string;
  memo: string;
}

export interface ServerManagedEvidence {
  cardId: string;
  originChannel: "android-notification";
  creatorMemberId: string;
  captureLineageId: string;
}

export interface LedgerTransactionSnapshot {
  transactionId: string;
  lifecycle: "active" | "superseded" | "deleted";
  version: number;
  merchant: string;
  amountInWon: number;
  categoryId: string;
  memo: string;
  evidence: ServerManagedEvidence;
}

export type QuickEditSplitOutcome =
  | {
      kind: "Success";
      derivedTransactions: readonly LedgerTransactionSnapshot[];
    }
  | {
      kind: "Conflict";
      code: "VERSION_MISMATCH";
      targetLifecycle: "active" | "superseded" | "deleted";
      mayRecreateDraftAfterConfirmation: boolean;
    };

export type QuickEditSplitReconfirmationOutcome =
  | {
      kind: "DraftRecreated";
      expectedVersion: number;
    }
  | {
      kind: "Rejected";
      code: "TARGET_NOT_ACTIVE";
    };

export interface QuickEditSplitState {
  form: QuickEditFormSnapshot;
  draft?: {
    baseForm: QuickEditFormSnapshot;
    items: readonly QuickEditSplitItem[];
  };
  ledgerTransactions: readonly LedgerTransactionSnapshot[];
}

export interface QuickEditSplitConflictContractSubject {
  editForm(
    patch: Partial<Pick<QuickEditFormSnapshot, "merchant" | "amountInWon" | "categoryId" | "memo">>,
  ): void;
  beginSplit(items: readonly QuickEditSplitItem[]): void;
  applyConcurrentServerChange(change: {
    lifecycle?: "active" | "superseded" | "deleted";
    merchant?: string;
    version: number;
  }): void;
  submitSplit(): Promise<QuickEditSplitOutcome>;
  confirmLatestActiveAndRecreateDraft(): QuickEditSplitReconfirmationOutcome;
  state(): QuickEditSplitState;
}

export function createSubject(fixture?: {
  transaction?: LedgerTransactionSnapshot;
}): QuickEditSplitConflictContractSubject {
  return createQuickEditSplitConflictFixture(fixture);
}

const evidence: ServerManagedEvidence = {
  cardId: "card-1",
  originChannel: "android-notification",
  creatorMemberId: "member-creator",
  captureLineageId: "capture-lineage-1",
};

const original = (): LedgerTransactionSnapshot => ({
  transactionId: "transaction-1",
  lifecycle: "active",
  version: 7,
  merchant: "저장된 가맹점",
  amountInWon: 100_000,
  categoryId: "category-old",
  memo: "저장된 메모",
  evidence,
});

const unsavedForm = {
  merchant: "화면에서 바꾼 가맹점",
  amountInWon: 90_000,
  categoryId: "category-new",
  memo: "화면에서 바꾼 메모",
} as const;

const splitItems: readonly QuickEditSplitItem[] = [
  { ...unsavedForm, amountInWon: 40_000 },
  { ...unsavedForm, amountInWon: 50_000 },
];

describe("QuickEdit 현재 form 원자 분할·충돌 공개 계약", () => {
  it("[T-QE-004][QE-010][DEC-055] 저장하지 않은 현재 form 전체를 immutable base로 분할하고 서버 관리 evidence를 원본에서 보존한다", async () => {
    const subject = createSubject({ transaction: original() });
    subject.editForm(unsavedForm);
    subject.beginSplit(splitItems);

    const outcome = await subject.submitSplit();

    expect(outcome.kind).toBe("Success");
    if (outcome.kind === "Success") {
      expect(outcome.derivedTransactions).toHaveLength(2);
      expect(
        outcome.derivedTransactions.reduce(
          (sum, transaction) => sum + transaction.amountInWon,
          0,
        ),
      ).toBe(90_000);
      expect(
        outcome.derivedTransactions.map(
          ({ merchant, categoryId, memo, evidence: preservedEvidence }) => ({
            merchant,
            categoryId,
            memo,
            evidence: preservedEvidence,
          }),
        ),
      ).toEqual([
        {
          merchant: unsavedForm.merchant,
          categoryId: unsavedForm.categoryId,
          memo: unsavedForm.memo,
          evidence,
        },
        {
          merchant: unsavedForm.merchant,
          categoryId: unsavedForm.categoryId,
          memo: unsavedForm.memo,
          evidence,
        },
      ]);
      expect(
        subject
          .state()
          .ledgerTransactions.find(
            ({ transactionId }) => transactionId === "transaction-1",
          ),
      ).toMatchObject({
        transactionId: "transaction-1",
        lifecycle: "superseded",
        evidence,
      });
      expect(
        subject
          .state()
          .ledgerTransactions.filter(({ lifecycle }) => lifecycle === "active"),
      ).toEqual(outcome.derivedTransactions);
    }
  });

  it("[T-QE-004][QE-010][DEC-055] 다른 수정으로 expectedVersion이 바뀌면 write 없이 전체 Conflict로 거부하고 로컬 form·draft를 유지한다", async () => {
    const subject = createSubject({ transaction: original() });
    subject.editForm(unsavedForm);
    subject.beginSplit(splitItems);
    subject.applyConcurrentServerChange({
      version: 8,
      merchant: "다른 사용자가 먼저 저장한 가맹점",
    });

    expect(await subject.submitSplit()).toEqual({
      kind: "Conflict",
      code: "VERSION_MISMATCH",
      targetLifecycle: "active",
      mayRecreateDraftAfterConfirmation: true,
    });
    expect(subject.state()).toEqual({
      form: {
        transactionId: "transaction-1",
        ...unsavedForm,
        expectedVersion: 7,
      },
      draft: {
        baseForm: {
          transactionId: "transaction-1",
          ...unsavedForm,
          expectedVersion: 7,
        },
        items: splitItems,
      },
      ledgerTransactions: [
        {
          ...original(),
          version: 8,
          merchant: "다른 사용자가 먼저 저장한 가맹점",
        },
      ],
    });
  });

  it.each(["superseded", "deleted"] as const)(
    "[T-QE-004][QE-010][DEC-055] 원본이 이미 %s이면 같은 원본으로 재제출할 수 없다",
    async (lifecycle) => {
      const subject = createSubject({ transaction: original() });
      subject.editForm(unsavedForm);
      subject.beginSplit(splitItems);
      subject.applyConcurrentServerChange({ version: 8, lifecycle });

      expect(await subject.submitSplit()).toEqual({
        kind: "Conflict",
        code: "VERSION_MISMATCH",
        targetLifecycle: lifecycle,
        mayRecreateDraftAfterConfirmation: false,
      });
      expect(subject.state().draft).toEqual({
        baseForm: {
          transactionId: "transaction-1",
          ...unsavedForm,
          expectedVersion: 7,
        },
        items: splitItems,
      });
      expect(subject.confirmLatestActiveAndRecreateDraft()).toEqual({
        kind: "Rejected",
        code: "TARGET_NOT_ACTIVE",
      });
    },
  );

  it("[T-QE-004][QE-010][DEC-055] active 대상의 version 충돌은 사용자 재확인 뒤에만 최신 version의 새 immutable draft로 다시 제출한다", async () => {
    const subject = createSubject({ transaction: original() });
    subject.editForm(unsavedForm);
    subject.beginSplit(splitItems);
    subject.applyConcurrentServerChange({
      version: 8,
      merchant: "다른 사용자가 먼저 저장한 가맹점",
    });
    expect(await subject.submitSplit()).toMatchObject({
      kind: "Conflict",
      targetLifecycle: "active",
      mayRecreateDraftAfterConfirmation: true,
    });

    expect(subject.confirmLatestActiveAndRecreateDraft()).toEqual({
      kind: "DraftRecreated",
      expectedVersion: 8,
    });
    expect(subject.state().draft).toEqual({
      baseForm: {
        transactionId: "transaction-1",
        ...unsavedForm,
        expectedVersion: 8,
      },
      items: splitItems,
    });

    const retried = await subject.submitSplit();
    expect(retried.kind).toBe("Success");
    if (retried.kind === "Success") {
      expect(retried.derivedTransactions).toHaveLength(2);
      expect(
        retried.derivedTransactions.reduce(
          (sum, transaction) => sum + transaction.amountInWon,
          0,
        ),
      ).toBe(unsavedForm.amountInWon);
    }
    expect(
      subject
        .state()
        .ledgerTransactions.find(
          ({ transactionId }) => transactionId === "transaction-1",
        ),
    ).toMatchObject({ lifecycle: "superseded", version: 9 });
  });

  it("분할을 시작한 뒤 화면 form을 더 수정해도 이미 만든 immutable base와 항목은 변하지 않는다", async () => {
    const subject = createSubject({ transaction: original() });
    subject.editForm(unsavedForm);
    subject.beginSplit(splitItems);
    subject.editForm({ merchant: "분할 시작 뒤 변경" });

    const outcome = await subject.submitSplit();

    expect(outcome.kind).toBe("Success");
    if (outcome.kind === "Success") {
      expect(outcome.derivedTransactions.map(({ merchant }) => merchant)).toEqual([
        unsavedForm.merchant,
        unsavedForm.merchant,
      ]);
    }
    expect(subject.state().draft?.baseForm.merchant).toBe(unsavedForm.merchant);
    expect(subject.state().form.merchant).toBe("분할 시작 뒤 변경");
  });

  it("beginSplit 호출 뒤 호출자가 원본 item 객체를 바꿔도 저장할 draft는 오염되지 않는다", () => {
    const subject = createSubject({ transaction: original() });
    subject.editForm(unsavedForm);
    const mutableItems = splitItems.map((item) => ({ ...item }));
    subject.beginSplit(mutableItems);

    mutableItems[0].merchant = "호출자가 바꾼 값";

    expect(subject.state().draft?.items[0].merchant).toBe(unsavedForm.merchant);
  });
});
