import { describe, expect, it } from "vitest";
import type { SensitiveAndroidFlowInput } from "../../../support/log-redaction-fixture";
import {
  createLogRedactionFixtureSubject,
  type LogRedactionFixtureSubject,
} from "../../../support/log-redaction-fixture";

export interface AndroidLogRedactionContractSubject
  extends LogRedactionFixtureSubject {}

export function createSubject(): AndroidLogRedactionContractSubject {
  return createLogRedactionFixtureSubject();
}

const sensitiveFlow = (
  overrides: Partial<SensitiveAndroidFlowInput> = {},
): SensitiveAndroidFlowInput => ({
  operation: "notification-capture",
  outcome: "failure",
  errorCode: "CAPTURE_RETRYABLE",
  householdId: "household-sensitive-1",
  householdKey: "legacy-household-key",
  memberName: "민감한 멤버 이름",
  fid: "firebase-installation-id",
  registrationToken: "legacy-registration-token",
  authToken: "firebase-auth-token",
  notificationRaw: "삼성카드 1234 승인 10,000원 민감 가맹점",
  transactionMemo: "개인적인 거래 메모",
  ...overrides,
});

describe("Android 로그 redaction 공개 계약", () => {
  it.each([
    { operation: "bridge", outcome: "success" },
    { operation: "fcm-registration", outcome: "failure" },
    { operation: "notification-capture", outcome: "success" },
    { operation: "quick-edit", outcome: "failure" },
  ] as const)(
    "[T-ANDROID-LOG-001][AND-008] $operation $outcome 흐름의 모든 sink에서 민감 원문을 제거한다",
    ({ operation, outcome }) => {
      const subject = createSubject();
      const fixture = sensitiveFlow({ operation, outcome });

      const result = subject.recordAcrossSinks(fixture);

      expect(result.kind).toBe("Recorded");
      expect(result.entries.map(({ sink }) => sink).sort()).toEqual([
        "analytics",
        "crash-breadcrumb",
        "logcat",
      ]);
      const rendered = JSON.stringify(subject.state().entries);
      for (const secret of [
        fixture.householdId,
        fixture.householdKey,
        fixture.memberName,
        fixture.fid,
        fixture.registrationToken,
        fixture.authToken,
        fixture.notificationRaw,
        fixture.transactionMemo,
      ]) {
        expect(rendered).not.toContain(secret);
      }
      expect(subject.state().entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation,
            outcome,
            errorCode: "CAPTURE_RETRYABLE",
          }),
        ]),
      );
    },
  );

  it("[T-ANDROID-LOG-001][AND-008] correlation이 필요해도 원문 대신 비가역 hash와 안정 오류 code만 남긴다", () => {
    const subject = createSubject();

    subject.recordAcrossSinks(sensitiveFlow());

    for (const entry of subject.state().entries) {
      expect(entry.errorCode).toBe("CAPTURE_RETRYABLE");
      expect(entry.correlationHash).toEqual(expect.any(String));
      expect(entry.correlationHash).not.toBe("");
      expect(entry.correlationHash).not.toBe("household-sensitive-1");
    }
  });

  it("[T-ANDROID-LOG-001][AND-008] errorCode 자리에 민감 원문이나 제어 문자가 들어오면 안정된 대체 code로 정규화한다", () => {
    const subject = createSubject();
    const fixture = sensitiveFlow({
      errorCode: "firebase-auth-token\n개인적인 거래 메모",
    });

    subject.recordAcrossSinks(fixture);

    for (const entry of subject.state().entries) {
      expect(entry.errorCode).toBe("UNSAFE_ERROR_CODE");
      expect(entry.renderedMessage).not.toContain(fixture.authToken);
      expect(entry.renderedMessage).not.toContain(fixture.transactionMemo);
      expect(entry.renderedMessage).not.toContain("\n");
    }
  });

  it("[T-ANDROID-LOG-001][AND-008] correlation은 FID나 token이 아니라 목적별 household hash만 사용한다", () => {
    const subject = createSubject();

    const first = subject.recordAcrossSinks(sensitiveFlow());
    const sameHousehold = subject.recordAcrossSinks(
      sensitiveFlow({
        fid: "a-different-fid",
        registrationToken: "a-different-token",
        authToken: "a-different-auth-token",
      }),
    );
    const differentHousehold = subject.recordAcrossSinks(
      sensitiveFlow({ householdId: "another-household-with-longer-id" }),
    );

    expect(first.entries[0].correlationHash).toBe(
      sameHousehold.entries[0].correlationHash,
    );
    expect(differentHousehold.entries[0].correlationHash).not.toBe(
      first.entries[0].correlationHash,
    );
  });

  it("[T-ANDROID-LOG-001][AND-008] correlation 기준 식별자가 없으면 빈 값의 hash를 만들지 않는다", () => {
    const subject = createSubject();

    const result = subject.recordAcrossSinks(sensitiveFlow({ householdId: "" }));

    expect(result.entries).toHaveLength(3);
    for (const entry of result.entries) {
      expect(entry).not.toHaveProperty("correlationHash");
      expect(entry.renderedMessage).not.toContain("correlationHash");
    }
  });
});
