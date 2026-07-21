import Ajv, { type AnySchema, type ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";

import { readContractJson } from "../../support/contract-json";

type OriginChannel = "android-notification" | "ios-shortcut";

interface PaymentObservationFixture {
  branchId: string;
  observationType: "approval" | "cancellation";
  amountInWon: number;
  occurredLocalDate?: string;
  occurredLocalTime?: string;
  zoneId: "Asia/Seoul";
  merchantEvidence: { rawCandidate: string };
  cardEvidence?: { companyLabel: string; maskedToken?: string };
  localCurrencyType?: string;
  dueDate?: string;
}

interface BalanceObservationFixture {
  branchId: string;
  currencyType: string;
  balanceInWon: number;
  observedAt: string;
}

type SourceEvidenceFixture =
  | {
      kind: "android-registered-package";
      sourceType: string;
      packageName: string;
      registryVersion: string;
    }
  | {
      kind: "ios-shortcut-credential";
      sourceType: "ios-shortcut";
      credentialIdHash: string;
    };

interface CaptureEnvelopeFixture {
  contractVersion: "capture-envelope.v1";
  observationId: string;
  originChannel: OriginChannel;
  sourceEvidence: SourceEvidenceFixture;
  observedAt: string;
  parser: { parserId: string; parserVersion: string };
  rawPayloadHash: string;
  paymentObservation?: PaymentObservationFixture;
  balanceObservation?: BalanceObservationFixture;
}

interface CaptureEnvelopeGoldenCase {
  caseId: string;
  requirementIds: string[];
  description: string;
  producer: "android-server-parser" | "shortcut-adapter";
  envelope: CaptureEnvelopeFixture;
  expectedConsumer: {
    consumer: "payment-intake";
    originChannel: OriginChannel;
    transactionBranch: "approval" | "cancellation" | "absent";
    balanceBranch: "present" | "absent";
  };
}

interface CaptureEnvelopeGoldenFixtureV1 {
  fixtureVersion: 1;
  contractVersion: "capture-envelope.v1";
  cases: CaptureEnvelopeGoldenCase[];
}

const schema = readContractJson<AnySchema>(
  "schemas/payment-capture/capture-envelope.v1.schema.json",
);
const fixture = readContractJson<CaptureEnvelopeGoldenFixtureV1>(
  "fixtures/payment-capture/capture-envelope.v1.json",
);

function compileSchema(): ValidateFunction {
  return new Ajv({ allErrors: true, strict: true }).compile(schema);
}

function expectValid(
  validate: ValidateFunction,
  envelope: unknown,
): void {
  expect(
    validate(envelope),
    JSON.stringify(validate.errors, null, 2),
  ).toBe(true);
}

function expectInvalid(
  validate: ValidateFunction,
  envelope: unknown,
): void {
  expect(validate(envelope), "유효하지 않은 envelope가 통과했습니다.").toBe(
    false,
  );
}

function caseById(caseId: string): CaptureEnvelopeGoldenCase {
  const found = fixture.cases.find((testCase) => testCase.caseId === caseId);
  if (!found) {
    throw new Error(`CaptureEnvelope fixture case를 찾을 수 없습니다: ${caseId}`);
  }
  return found;
}

describe("CaptureEnvelope.v1 producer·consumer 공유 계약", () => {
  it("[T-ING-003][T-IOS-001] AJV strict mode에서 모든 golden envelope가 Schema를 만족한다", () => {
    const validate = compileSchema();

    expect(fixture.fixtureVersion).toBe(1);
    expect(fixture.contractVersion).toBe("capture-envelope.v1");
    for (const testCase of fixture.cases) {
      expectValid(validate, testCase.envelope);
    }
  });

  it("[T-PARSE-001][T-PARSE-002][T-ING-BAL-001][T-PARSE-004] producer 결과와 Payment Intake의 branch 해석이 일치한다", () => {
    const expectedCaseIds = [
      "android-approval-only",
      "android-balance-only",
      "android-cancellation-only",
      "android-payment-and-balance",
      "ios-shortcut-approval-only",
    ];
    const caseIds = fixture.cases.map(({ caseId }) => caseId);

    expect(new Set(caseIds).size).toBe(caseIds.length);
    expect([...caseIds].sort()).toEqual(expectedCaseIds.sort());

    for (const testCase of fixture.cases) {
      const { envelope, expectedConsumer } = testCase;
      expect(expectedConsumer.consumer).toBe("payment-intake");
      expect(expectedConsumer.originChannel).toBe(envelope.originChannel);
      expect(expectedConsumer.transactionBranch).toBe(
        envelope.paymentObservation?.observationType ?? "absent",
      );
      expect(expectedConsumer.balanceBranch).toBe(
        envelope.balanceObservation ? "present" : "absent",
      );
      expect(envelope.paymentObservation?.branchId).not.toBe(
        envelope.balanceObservation?.branchId,
      );
    }
  });

  it("[T-ING-003][DEC-005] Android source는 등록 package 증거만 허용하고 Shortcut credential 필드는 거부한다", () => {
    const validate = compileSchema();
    const envelope = caseById("android-approval-only").envelope;
    if (envelope.sourceEvidence.kind !== "android-registered-package") {
      throw new Error("Android fixture의 source kind가 잘못되었습니다.");
    }
    const { packageName: _packageName, ...withoutPackage } =
      envelope.sourceEvidence;

    expectInvalid(validate, {
      ...envelope,
      sourceEvidence: withoutPackage,
    });
    expectInvalid(validate, {
      ...envelope,
      sourceEvidence: {
        ...envelope.sourceEvidence,
        credentialIdHash:
          "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      },
    });
    expectInvalid(validate, {
      ...envelope,
      sourceEvidence: {
        ...envelope.sourceEvidence,
        parserId: envelope.parser.parserId,
      },
    });
    const { parser: _parser, ...withoutParser } = envelope;
    expectInvalid(validate, withoutParser);
  });

  it("[T-IOS-001][IOS-013] Shortcut source는 credential hash만 허용하고 package·registry 필드와 채널 불일치를 거부한다", () => {
    const validate = compileSchema();
    const envelope = caseById("ios-shortcut-approval-only").envelope;
    if (envelope.sourceEvidence.kind !== "ios-shortcut-credential") {
      throw new Error("Shortcut fixture의 source kind가 잘못되었습니다.");
    }
    const { credentialIdHash: _credentialIdHash, ...withoutCredential } =
      envelope.sourceEvidence;

    expectInvalid(validate, {
      ...envelope,
      sourceEvidence: withoutCredential,
    });
    expectInvalid(validate, {
      ...envelope,
      sourceEvidence: {
        ...envelope.sourceEvidence,
        packageName: "com.example.fake",
        registryVersion: "source-registry.v1",
      },
    });
    expectInvalid(validate, {
      ...envelope,
      originChannel: "android-notification",
    });
  });

  it("[T-ING-BAL-001][IOS-001] branch가 하나도 없는 입력과 Shortcut의 balance·cancellation 입력을 거부한다", () => {
    const validate = compileSchema();
    const android = caseById("android-approval-only").envelope;
    const shortcut = caseById("ios-shortcut-approval-only").envelope;
    const {
      paymentObservation: _paymentObservation,
      balanceObservation: _balanceObservation,
      ...withoutBranches
    } = android;

    expectInvalid(validate, withoutBranches);
    expectInvalid(validate, {
      ...shortcut,
      balanceObservation: caseById("android-balance-only").envelope
        .balanceObservation,
    });
    expectInvalid(validate, {
      ...shortcut,
      paymentObservation: {
        ...shortcut.paymentObservation,
        observationType: "cancellation",
      },
    });
  });

  it("[T-CAN-003] Android 취소는 발생 날짜·시각을 함께 생략해 관찰 시각 fallback을 요청할 수 있다", () => {
    const validate = compileSchema();
    const envelope = caseById("android-cancellation-only").envelope;
    if (!envelope.paymentObservation) {
      throw new Error("취소 fixture에 payment branch가 없습니다.");
    }
    const {
      occurredLocalDate: _occurredLocalDate,
      occurredLocalTime: _occurredLocalTime,
      ...withoutOccurrence
    } = envelope.paymentObservation;

    expectValid(validate, {
      ...envelope,
      paymentObservation: withoutOccurrence,
    });
    expectInvalid(validate, {
      ...envelope,
      paymentObservation: {
        ...withoutOccurrence,
        occurredLocalDate: "2026-07-20",
      },
    });
  });

  it("[T-IOS-SEC-002][ING-SAVE-006] household와 creator 신원은 Envelope 어느 계층에도 포함할 수 없다", () => {
    const validate = compileSchema();
    const envelope = caseById("android-approval-only").envelope;

    expectInvalid(validate, { ...envelope, householdId: "household-forged" });
    expectInvalid(validate, {
      ...envelope,
      creatorMemberId: "member-forged",
    });
    expectInvalid(validate, {
      ...envelope,
      paymentObservation: {
        ...envelope.paymentObservation,
        creatorMemberId: "member-forged",
      },
    });
  });
});
