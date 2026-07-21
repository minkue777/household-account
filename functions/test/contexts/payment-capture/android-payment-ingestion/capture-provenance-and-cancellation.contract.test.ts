import { describe, expect, it } from "vitest";
import { createCaptureProvenanceCancellationDriver } from "../../../support/capture-provenance-cancellation-driver";

interface CaptureProvenance {
  observationId: string;
  captureLineageId: string;
  source: { sourceType: string; registryVersion: string };
  parser: { parserId: string; parserVersion: string };
  originalAmountInWon: number;
  originalMerchantEvidence: string;
  originalCardEvidence: { companyLabel: string; maskedToken?: string };
  originalOccurredLocalDate: string;
  originalOccurredLocalTime: string;
  rawPayloadHash: string;
}

interface CapturedTransaction {
  transactionId: string;
  householdId: string;
  creatorMemberId: string;
  captureLineageIds: readonly string[];
  lifecycle: "active" | "superseded";
  displayed: {
    amountInWon: number;
    merchant: string;
    occurredLocalDate: string;
    occurredLocalTime: string;
  };
  provenanceByLineage: Readonly<Record<string, CaptureProvenance>>;
}

interface ApprovalCaptureInput {
  transactionId: string;
  actor: {
    householdId: string;
    memberId?: string;
    capability: "paymentCapture:submit";
  };
  provenance: CaptureProvenance;
}

interface CancellationEvidence {
  amountInWon: number;
  merchantEvidence: string;
  cardEvidence: { companyLabel: string; maskedToken?: string };
  occurredLocalDate: string;
  occurredLocalTime: string;
}

type ApprovalCaptureResult =
  | {
      kind: "Created";
      transactionId: string;
      captureLineageId: string;
      creatorMemberId: string;
    }
  | { kind: "Duplicate"; existingTransactionId: string }
  | { kind: "Rejected"; code: "CREATOR_REQUIRED" };

type ProvenanceCancellationResult =
  | {
      kind: "Cancelled";
      captureLineageId: string;
      deletedTransactionIds: readonly string[];
      restoredTransactionIds: readonly string[];
    }
  | { kind: "NotFound" }
  | { kind: "NeedsConfirmation"; captureLineageIds: readonly string[] }
  | { kind: "ContractFailure"; code: "INCOMPLETE_LEGACY_LINEAGE" }
  | { kind: "RetryableFailure"; code: "ATOMIC_COMMIT_FAILED" };

interface CaptureProvenanceState {
  transactions: readonly CapturedTransaction[];
  dedupClaims: readonly {
    fingerprint: string;
    transactionId: string;
    state: "active" | "cancelled";
  }[];
  cancellationReceipts: readonly {
    captureLineageId: string;
    deletedTransactionIds: readonly string[];
    restoredTransactionIds: readonly string[];
  }[];
  rawPayloads: readonly string[];
}

export interface CaptureProvenanceCancellationSubject {
  captureApproval(input: ApprovalCaptureInput): ApprovalCaptureResult;
  cancel(input: {
    actor: { householdId: string; memberId: string };
    evidence: CancellationEvidence;
    commitOutcome?: "success" | "failure";
  }): ProvenanceCancellationResult;
  availableUserCommands(): readonly string[];
  state(): CaptureProvenanceState;
}

export function createSubject(fixture?: {
  transactions?: readonly CapturedTransaction[];
  legacyIncompleteLineageIds?: readonly string[];
}): CaptureProvenanceCancellationSubject {
  return createCaptureProvenanceCancellationDriver(fixture);
}

function provenance(overrides: Partial<CaptureProvenance> = {}): CaptureProvenance {
  return {
    observationId: "observation-a",
    captureLineageId: "lineage-a",
    source: { sourceType: "kb-card", registryVersion: "source-registry.v1" },
    parser: { parserId: "kb-card-parser", parserVersion: "2.0.0" },
    originalAmountInWon: 10_000,
    originalMerchantEvidence: "가맹점 가",
    originalCardEvidence: { companyLabel: "국민", maskedToken: "1234" },
    originalOccurredLocalDate: "2026-07-19",
    originalOccurredLocalTime: "10:05",
    rawPayloadHash: `sha256:${"a".repeat(64)}`,
    ...overrides,
  };
}

function activeTransaction(input: {
  transactionId: string;
  lineages: readonly CaptureProvenance[];
  displayed?: Partial<CapturedTransaction["displayed"]>;
  lifecycle?: "active" | "superseded";
}): CapturedTransaction {
  return {
    transactionId: input.transactionId,
    householdId: "household-a",
    creatorMemberId: "member-a",
    captureLineageIds: input.lineages.map(({ captureLineageId }) => captureLineageId),
    lifecycle: input.lifecycle ?? "active",
    displayed: {
      amountInWon: 10_000,
      merchant: "가맹점 가",
      occurredLocalDate: "2026-07-19",
      occurredLocalTime: "10:05",
      ...input.displayed,
    },
    provenanceByLineage: Object.fromEntries(
      input.lineages.map((item) => [item.captureLineageId, item]),
    ),
  };
}

function cancellationEvidence(source = provenance()): CancellationEvidence {
  return {
    amountInWon: source.originalAmountInWon,
    merchantEvidence: source.originalMerchantEvidence,
    cardEvidence: source.originalCardEvidence,
    occurredLocalDate: source.originalOccurredLocalDate,
    occurredLocalTime: source.originalOccurredLocalTime,
  };
}

describe("불변 capture provenance·lineage 취소 공개 계약", () => {
  it("[T-ING-PROV-001][ING-SAVE-006][ING-SAVE-007] creator와 전체 provenance를 거래와 원자 저장하며 원문은 저장하지 않는다", () => {
    const subject = createSubject();
    const source = provenance();

    expect(
      subject.captureApproval({
        transactionId: "expense-a",
        actor: {
          householdId: "household-a",
          memberId: "member-a",
          capability: "paymentCapture:submit",
        },
        provenance: source,
      }),
    ).toEqual({
      kind: "Created",
      transactionId: "expense-a",
      captureLineageId: "lineage-a",
      creatorMemberId: "member-a",
    });
    expect(subject.state().transactions).toEqual([
      activeTransaction({ transactionId: "expense-a", lineages: [source] }),
    ]);
    expect(subject.state().rawPayloads).toEqual([]);
  });

  it("[T-ING-PROV-001][ING-SAVE-007] 승인 뒤 입력 객체가 바뀌어도 저장한 원 provenance 스냅샷은 변하지 않는다", () => {
    const subject = createSubject();
    const source = provenance();

    subject.captureApproval({
      transactionId: "expense-a",
      actor: {
        householdId: "household-a",
        memberId: "member-a",
        capability: "paymentCapture:submit",
      },
      provenance: source,
    });
    source.source.sourceType = "changed-source";
    source.parser.parserVersion = "changed-version";
    source.originalCardEvidence.maskedToken = "9999";
    source.originalMerchantEvidence = "변경된 가맹점";

    expect(subject.state().transactions).toEqual([
      activeTransaction({
        transactionId: "expense-a",
        lineages: [provenance()],
      }),
    ]);
  });

  it("[T-ING-AUTH-001][ING-SAVE-006] creator가 없으면 거래·claim·receipt를 하나도 만들지 않는다", () => {
    const subject = createSubject();

    expect(
      subject.captureApproval({
        transactionId: "expense-a",
        actor: {
          householdId: "household-a",
          capability: "paymentCapture:submit",
        },
        provenance: provenance(),
      }),
    ).toEqual({ kind: "Rejected", code: "CREATOR_REQUIRED" });
    expect(subject.state()).toEqual({
      transactions: [],
      dedupClaims: [],
      cancellationReceipts: [],
      rawPayloads: [],
    });
  });

  it.each([
    ["날짜", { originalOccurredLocalDate: "2026-07-18" }],
    ["분", { originalOccurredLocalTime: "10:04" }],
    ["금액", { originalAmountInWon: 10_001 }],
    ["정규 가맹점", { originalMerchantEvidence: "가맹점 나" }],
  ] as const)(
    "[T-DUP-001][ING-SAVE-005] fingerprint의 %s이 다르면 별도 승인을 중복으로 막지 않는다",
    (_name, difference) => {
      const subject = createSubject();
      const first = provenance();
      const second = provenance({
        observationId: `observation-${Object.keys(difference)[0]}`,
        captureLineageId: `lineage-${Object.keys(difference)[0]}`,
        ...difference,
      });

      expect(
        subject.captureApproval({
          transactionId: "expense-a",
          actor: {
            householdId: "household-a",
            memberId: "member-a",
            capability: "paymentCapture:submit",
          },
          provenance: first,
        }),
      ).toMatchObject({ kind: "Created" });
      expect(
        subject.captureApproval({
          transactionId: "expense-b",
          actor: {
            householdId: "household-a",
            memberId: "member-a",
            capability: "paymentCapture:submit",
          },
          provenance: second,
        }),
      ).toMatchObject({ kind: "Created" });
      expect(subject.state().transactions).toHaveLength(2);
      expect(subject.state().dedupClaims).toHaveLength(2);
    },
  );

  it("[T-DUP-001][ING-SAVE-005] 카드·수집원·parser가 달라도 household·날짜·분·금액·정규 가맹점이 같으면 중복이다", () => {
    const subject = createSubject();
    const first = provenance();
    const sameFingerprint = provenance({
      observationId: "observation-b",
      captureLineageId: "lineage-b",
      source: {
        sourceType: "different-card-app",
        registryVersion: "source-registry.v2",
      },
      parser: { parserId: "different-parser", parserVersion: "9.0.0" },
      originalMerchantEvidence: "  가맹점   가 ",
      originalCardEvidence: { companyLabel: "삼성", maskedToken: "9999" },
      rawPayloadHash: `sha256:${"b".repeat(64)}`,
    });

    expect(
      subject.captureApproval({
        transactionId: "expense-a",
        actor: {
          householdId: "household-a",
          memberId: "member-a",
          capability: "paymentCapture:submit",
        },
        provenance: first,
      }),
    ).toMatchObject({ kind: "Created" });
    expect(
      subject.captureApproval({
        transactionId: "expense-b",
        actor: {
          householdId: "household-a",
          memberId: "member-a",
          capability: "paymentCapture:submit",
        },
        provenance: sameFingerprint,
      }),
    ).toEqual({ kind: "Duplicate", existingTransactionId: "expense-a" });
    expect(subject.state().transactions).toHaveLength(1);
    expect(subject.state().dedupClaims).toHaveLength(1);
  });

  it("[T-DUP-001][ING-SAVE-005] 나머지 fingerprint 항목이 같아도 household가 다르면 별도 승인이다", () => {
    const subject = createSubject();

    expect(
      subject.captureApproval({
        transactionId: "expense-a",
        actor: {
          householdId: "household-a",
          memberId: "member-a",
          capability: "paymentCapture:submit",
        },
        provenance: provenance(),
      }),
    ).toMatchObject({ kind: "Created" });
    expect(
      subject.captureApproval({
        transactionId: "expense-b",
        actor: {
          householdId: "household-b",
          memberId: "member-b",
          capability: "paymentCapture:submit",
        },
        provenance: provenance({
          observationId: "observation-b",
          captureLineageId: "lineage-b",
        }),
      }),
    ).toMatchObject({ kind: "Created" });
    expect(subject.state().transactions).toHaveLength(2);
    expect(subject.state().dedupClaims).toHaveLength(2);
  });

  it("[T-ING-PROV-001][T-CAN-LINEAGE-001][CAN-003][CAN-007] 표시값을 수정·분할해도 원 provenance로 유일 lineage를 찾아 원본·파생을 함께 취소한다", () => {
    const source = provenance();
    const superseded = activeTransaction({
      transactionId: "expense-original",
      lineages: [source],
      lifecycle: "superseded",
    });
    const splitA = activeTransaction({
      transactionId: "expense-split-a",
      lineages: [source],
      displayed: { amountInWon: 4_000, merchant: "수정 가맹점" },
    });
    const splitB = activeTransaction({
      transactionId: "expense-split-b",
      lineages: [source],
      displayed: { amountInWon: 6_000, merchant: "수정 가맹점" },
    });
    const subject = createSubject({ transactions: [superseded, splitA, splitB] });

    const result = subject.cancel({
      actor: { householdId: "household-a", memberId: "member-a" },
      evidence: cancellationEvidence(source),
    });

    expect(result).toMatchObject({
      kind: "Cancelled",
      captureLineageId: "lineage-a",
      restoredTransactionIds: [],
    });
    if (result.kind !== "Cancelled") throw new Error("Cancelled 결과가 필요합니다.");
    expect(new Set(result.deletedTransactionIds)).toEqual(
      new Set(["expense-original", "expense-split-a", "expense-split-b"]),
    );
    expect(subject.state().transactions).toEqual([]);
    expect(subject.state().dedupClaims).toEqual([
      expect.objectContaining({
        transactionId: "expense-original",
        state: "cancelled",
      }),
    ]);
  });

  it("[T-CAN-LINEAGE-001][CAN-007] 다른 승인과 합쳐진 파생 거래는 제거하고 다른 lineage만 같은 UoW에서 복원한다", () => {
    const sourceA = provenance();
    const sourceB = provenance({
      observationId: "observation-b",
      captureLineageId: "lineage-b",
      originalAmountInWon: 20_000,
      originalMerchantEvidence: "가맹점 나",
      originalCardEvidence: { companyLabel: "삼성", maskedToken: "5678" },
      originalOccurredLocalTime: "11:05",
      rawPayloadHash: `sha256:${"b".repeat(64)}`,
    });
    const merged = activeTransaction({
      transactionId: "expense-merged",
      lineages: [sourceA, sourceB],
      displayed: { amountInWon: 30_000, merchant: "합친 거래" },
    });
    const subject = createSubject({ transactions: [merged] });

    const result = subject.cancel({
      actor: { householdId: "household-a", memberId: "member-a" },
      evidence: cancellationEvidence(sourceA),
    });

    expect(result).toEqual({
      kind: "Cancelled",
      captureLineageId: "lineage-a",
      deletedTransactionIds: ["expense-merged"],
      restoredTransactionIds: [expect.any(String)],
    });
    if (result.kind !== "Cancelled") throw new Error("Cancelled 결과가 필요합니다.");
    expect(subject.state().transactions).toEqual([
      activeTransaction({
        transactionId: result.restoredTransactionIds[0],
        lineages: [sourceB],
        displayed: {
          amountInWon: 20_000,
          merchant: "가맹점 나",
          occurredLocalTime: "11:05",
        },
      }),
    ]);
  });

  it.each([
    {
      name: "금액",
      difference: { amountInWon: 10_001 },
    },
    {
      name: "가맹점",
      difference: { merchantEvidence: "가맹점 나" },
    },
    {
      name: "카드",
      difference: {
        cardEvidence: { companyLabel: "국민", maskedToken: "9999" },
      },
    },
  ] as const)(
    "[T-CAN-003][T-CAN-LINEAGE-001][CAN-007] 불변 provenance와 $name이 다른 취소 증거는 lineage를 제거하지 않는다",
    ({ difference }) => {
      const source = provenance();
      const subject = createSubject({
        transactions: [
          activeTransaction({ transactionId: "expense-a", lineages: [source] }),
        ],
      });
      const before = subject.state();

      expect(
        subject.cancel({
          actor: { householdId: "household-a", memberId: "member-a" },
          evidence: { ...cancellationEvidence(source), ...difference },
        }),
      ).toEqual({ kind: "NotFound" });
      expect(subject.state()).toEqual(before);
    },
  );

  it("[T-CAN-003][T-CAN-LINEAGE-001][CAN-007] 같은 증거라도 다른 household의 lineage는 취소하지 않는다", () => {
    const source = provenance();
    const subject = createSubject({
      transactions: [
        activeTransaction({ transactionId: "expense-a", lineages: [source] }),
      ],
    });
    const before = subject.state();

    expect(
      subject.cancel({
        actor: { householdId: "household-b", memberId: "member-b" },
        evidence: cancellationEvidence(source),
      }),
    ).toEqual({ kind: "NotFound" });
    expect(subject.state()).toEqual(before);
  });

  it.each([
    {
      name: "원거래 없음",
      fixture: { transactions: [] },
      expected: { kind: "NotFound" } as const,
    },
    {
      name: "동일 증거 후보 둘",
      fixture: {
        transactions: [
          activeTransaction({ transactionId: "expense-a", lineages: [provenance()] }),
          activeTransaction({
            transactionId: "expense-b",
            lineages: [
              provenance({ observationId: "observation-b", captureLineageId: "lineage-b" }),
            ],
          }),
        ],
      },
      expected: {
        kind: "NeedsConfirmation",
        captureLineageIds: ["lineage-a", "lineage-b"],
      } as const,
    },
  ])(
    "[T-CAN-002][T-CAN-LINEAGE-001][CAN-003][CAN-007] $name은 임의 취소·대기 tombstone 없이 무변경이다",
    ({ fixture, expected }) => {
      const subject = createSubject(fixture);
      const before = subject.state();

      expect(
        subject.cancel({
          actor: { householdId: "household-a", memberId: "member-a" },
          evidence: cancellationEvidence(),
        }),
      ).toEqual(expected);
      expect(subject.state()).toEqual(before);
    },
  );

  it("[T-CAN-LINEAGE-001][CAN-007] provenance가 불완전한 legacy lineage는 추측하지 않고 typed 계약 실패로 끝난다", () => {
    const legacy = activeTransaction({
      transactionId: "expense-legacy",
      lineages: [provenance({ captureLineageId: "lineage-legacy" })],
    });
    const subject = createSubject({
      transactions: [legacy],
      legacyIncompleteLineageIds: ["lineage-legacy"],
    });
    const before = subject.state();

    expect(
      subject.cancel({
        actor: { householdId: "household-a", memberId: "member-a" },
        evidence: cancellationEvidence(
          provenance({ captureLineageId: "lineage-legacy" }),
        ),
      }),
    ).toEqual({
      kind: "ContractFailure",
      code: "INCOMPLETE_LEGACY_LINEAGE",
    });
    expect(subject.state()).toEqual(before);
  });

  it("[T-CAN-001][T-CAN-LINEAGE-001][CAN-005][CAN-007] 취소 commit 실패는 파생 삭제·다른 lineage 복원·receipt·claim을 모두 rollback한다", () => {
    const source = provenance();
    const transaction = activeTransaction({
      transactionId: "expense-a",
      lineages: [source],
    });
    const subject = createSubject({ transactions: [transaction] });
    const before = subject.state();

    expect(
      subject.cancel({
        actor: { householdId: "household-a", memberId: "member-a" },
        evidence: cancellationEvidence(source),
        commitOutcome: "failure",
      }),
    ).toEqual({ kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" });
    expect(subject.state()).toEqual(before);
  });

  it("[T-DUP-001][T-CAN-LINEAGE-001][CAN-007] 취소 뒤 남긴 dedup tombstone은 같은 승인 증거의 재등록을 막는다", () => {
    const source = provenance();
    const subject = createSubject({
      transactions: [
        activeTransaction({ transactionId: "expense-a", lineages: [source] }),
      ],
    });

    expect(
      subject.cancel({
        actor: { householdId: "household-a", memberId: "member-a" },
        evidence: cancellationEvidence(source),
      }),
    ).toMatchObject({ kind: "Cancelled" });
    expect(
      subject.captureApproval({
        transactionId: "expense-replayed",
        actor: {
          householdId: "household-a",
          memberId: "member-a",
          capability: "paymentCapture:submit",
        },
        provenance: provenance({
          observationId: "observation-replayed",
          captureLineageId: "lineage-replayed",
        }),
      }),
    ).toEqual({ kind: "Duplicate", existingTransactionId: "expense-a" });
    expect(subject.state().transactions).toEqual([]);
    expect(subject.state().dedupClaims).toEqual([
      expect.objectContaining({
        transactionId: "expense-a",
        state: "cancelled",
      }),
    ]);
  });

  it("[T-CAN-LINEAGE-001][CAN-007] 완료된 자동 취소를 일반 사용자가 되돌리는 Command는 제공하지 않는다", () => {
    expect(createSubject().availableUserCommands()).toEqual([
      "CaptureApproval",
      "CancelCapturedLineage",
    ]);
  });
});
