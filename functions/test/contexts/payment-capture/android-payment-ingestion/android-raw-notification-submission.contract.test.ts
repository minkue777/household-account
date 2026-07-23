import { describe, expect, it } from "vitest";

import {
  createAndroidRawNotificationSubmissionDriver,
  type AndroidRawNotificationInput,
  type CaptureSubmissionCommand,
} from "../../../support/raw-notification-submission-driver";

export interface AndroidRawNotificationSubmissionContractSubject {
  submit(input: {
    readonly actor: typeof actor;
    readonly input: AndroidRawNotificationInput;
  }): ReturnType<ReturnType<typeof createAndroidRawNotificationSubmissionDriver>["submit"]>;
  state(): { readonly captured: readonly CaptureSubmissionCommand[] };
}

export function createSubject(): AndroidRawNotificationSubmissionContractSubject {
  return createAndroidRawNotificationSubmissionDriver();
}

const actor = {
  principalId: "firebase-uid",
  householdId: "household-1",
  actingMemberId: "member-1",
  capabilities: ["paymentCapture:submit" as const],
};

function raw(
  overrides: Partial<AndroidRawNotificationInput> = {},
): AndroidRawNotificationInput {
  return {
    contractVersion: "android-raw-notification.v1",
    observationId: "observation.android.server-parser-1",
    packageName: "com.samsung.android.messaging",
    notification: {
      postedAt: "2026-07-31T17:41:00+09:00",
      title: "문자 메시지",
      textLines: [
        "[Web발신]",
        "삼성1876승인 이*선",
        "20,300원 일시불",
        "07/31 17:40 롯데쇼핑동탄",
        "누적881,545원",
      ],
    },
    ...overrides,
  };
}

describe("Android 원문 알림 서버 파싱 제출 계약", () => {
  it("등록 패키지로 서버가 파서를 선택하고 삼성 문자 원문을 기존 저장 계약으로 변환한다", async () => {
    const subject = createSubject();

    const result = await subject.submit({ actor, input: raw() });
    const captured = subject.state().captured;

    expect(result.kind).toBe("success");
    expect(result).toMatchObject({
      kind: "success",
      value: {
        transactionResult: {
          kind: "created",
          quickEditSnapshot: {
            transactionId: "transaction-1",
            amountInWon: 20_300,
            accountingDate: "2026-07-31",
            localTime: "17:40",
            aggregateVersion: 1,
          },
        },
      },
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      actor,
      rootIdempotencyKey: "observation.android.server-parser-1",
      envelope: {
        contractVersion: "capture-envelope.v1",
        originChannel: "android-notification",
        sourceEvidence: {
          kind: "android-registered-package",
          packageName: "com.samsung.android.messaging",
          sourceType: "sms-card-message",
          registryVersion: "source-registry.v1",
        },
        parser: {
          parserId: "sms-card-message-parser",
          parserVersion: "1.0.0",
        },
        paymentObservation: {
          observationType: "approval",
          amountInWon: 20_300,
          occurredLocalDate: "2026-07-31",
          occurredLocalTime: "17:40",
          merchantEvidence: { rawCandidate: "롯데쇼핑동탄" },
          cardEvidence: { companyLabel: "삼성", maskedToken: "1876" },
        },
      },
    });
    expect(captured[0].envelope.rawPayloadHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(captured[0].envelope)).not.toContain("이*선");
  });

  it("미등록 패키지와 파싱 불가 알림은 저장을 호출하지 않고 terminal로 소비한다", async () => {
    const subject = createSubject();

    for (const input of [
      raw({ packageName: "com.example.unregistered" }),
      raw({ notification: { postedAt: "2026-07-31T17:41:00+09:00", text: "일반 대화" } }),
    ]) {
      await expect(subject.submit({ actor, input })).resolves.toEqual({
        kind: "success",
        value: {
          observationId: "observation.android.server-parser-1",
          completion: "terminal",
        },
      });
    }
    expect(subject.state().captured).toHaveLength(0);
  });

  it("지역화폐 거래와 잔액을 한 번 파싱하되 독립 branch로 제출한다", async () => {
    const subject = createSubject();
    await subject.submit({
      actor,
      input: raw({
        packageName: "gov.sejong.yeominpay",
        notification: {
          postedAt: "2026-07-19T19:01:00+09:00",
          title: "여민전",
          textLines: [
            "결제 완료 8,000원",
            "가맹점너",
            "여민전 총 보유 잔액 32,000원",
          ],
        },
      }),
    });

    expect(subject.state().captured[0].envelope).toMatchObject({
      paymentObservation: {
        amountInWon: 8_000,
        localCurrencyType: "sejong",
      },
      balanceObservation: {
        balanceInWon: 32_000,
        currencyType: "sejong",
      },
    });
  });

  it("카카오톡에서는 도시가스 청구만 고정비 거래로 변환하고 카드 증거를 만들지 않는다", async () => {
    const subject = createSubject();
    await subject.submit({
      actor,
      input: raw({
        packageName: "com.kakao.talk",
        notification: {
          postedAt: "2026-04-02T08:30:00+09:00",
          title: "[2026년 3월 도시가스요금 청구서]",
          bigText:
            "도시가스요금 청구서\n납부하실 총 금액은 48,210원\n납부마감일은 2026년 4월 15일",
        },
      }),
    });

    const payment = subject.state().captured[0].envelope.paymentObservation;
    expect(payment).toMatchObject({
      amountInWon: 48_210,
      occurredLocalDate: "2026-04-15",
      occurredLocalTime: "08:30",
      merchantEvidence: { rawCandidate: "3월 도시가스요금" },
      dueDate: "2026-04-15",
    });
    expect(payment?.cardEvidence).toBeUndefined();
  });

  it("동일 원문은 결정적인 해시와 branch id를 만든다", async () => {
    const subject = createSubject();
    await subject.submit({ actor, input: raw() });
    await subject.submit({ actor, input: raw() });

    const envelopes = subject.state().captured.map((command) => command.envelope);
    expect(envelopes[0].rawPayloadHash).toBe(envelopes[1].rawPayloadHash);
    expect(envelopes[0].paymentObservation?.branchId).toBe(
      envelopes[1].paymentObservation?.branchId,
    );
  });
});
