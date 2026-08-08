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
  state(): {
    readonly captured: readonly CaptureSubmissionCommand[];
    readonly prefetched: readonly {
      readonly householdId: string;
      readonly actingMemberId: string;
    }[];
  };
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
  it("NH카드 분리형 문자를 농협 결제 observation으로 변환한다", async () => {
    const subject = createSubject();

    await subject.submit({
      actor,
      input: raw({
        observationId: "observation.android.nh-masked-1",
        notification: {
          postedAt: "2026-07-30T19:10:00+09:00",
          title: "메시지",
          textLines: [
            "[Web발신]",
            "NH카드4*3*승인",
            "김*휘",
            "5,760원 일시불",
            "07/30 19:09",
            "진로마트 행신점",
            "총누적1,431,944원",
          ],
        },
      }),
    });

    expect(subject.state().captured).toHaveLength(1);
    expect(subject.state().captured[0]).toMatchObject({
      actor,
      rootIdempotencyKey: "observation.android.nh-masked-1",
      envelope: {
        sourceEvidence: {
          packageName: "com.samsung.android.messaging",
          sourceType: "sms-card-message",
        },
        parser: { parserId: "sms-card-message-parser" },
        paymentObservation: {
          observationType: "approval",
          amountInWon: 5_760,
          occurredLocalDate: "2026-07-30",
          occurredLocalTime: "19:09",
          merchantEvidence: { rawCandidate: "진로마트 행신점" },
          cardEvidence: { companyLabel: "농협", maskedToken: "4*3*" },
        },
      },
    });
  });

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
          parserVersion: "1.1.0",
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
    expect(subject.state().prefetched).toEqual([
      { householdId: "household-1", actingMemberId: "member-1" },
    ]);
  });

  it("카카오톡의 현재 카드 메시지를 도시가스보다 먼저 선택하고 card branch로 제출한다", async () => {
    const subject = createSubject();

    await subject.submit({
      actor,
      input: raw({
        observationId: "observation.android.kakao-samsung-1",
        packageName: "com.kakao.talk",
        notification: {
          postedAt: "2026-08-08T14:49:00+09:00",
          title: "삼성카드",
          text:
            "[이민규] [오후 2:49] 삼성8481승인 이*규\n78,120원 일시불\n08/08 13:33 신세계사우스시티\n누적280,170원",
          bigText:
            "도시가스요금 청구서\n납부하실 총 금액은 48,210원\n납부마감일은 2026년 8월 15일",
        },
      }),
    });

    expect(subject.state().captured).toHaveLength(1);
    expect(subject.state().captured[0]).toMatchObject({
      paymentKind: "card",
      envelope: {
        sourceEvidence: {
          packageName: "com.kakao.talk",
          sourceType: "kakao-talk-financial-message",
        },
        parser: {
          parserId: "kakao-talk-financial-message-parser",
          parserVersion: "1.0.0",
        },
        paymentObservation: {
          amountInWon: 78_120,
          occurredLocalDate: "2026-08-08",
          occurredLocalTime: "13:33",
          merchantEvidence: { rawCandidate: "신세계사우스시티" },
          cardEvidence: { companyLabel: "삼성", maskedToken: "8481" },
        },
      },
    });
  });

  it("카카오톡 title의 카드 문구를 일반 body와 결합해 거래를 만들지 않는다", async () => {
    const subject = createSubject();

    await expect(
      subject.submit({
        actor,
        input: raw({
          observationId: "observation.android.kakao-forged-title",
          packageName: "com.kakao.talk",
          notification: {
            postedAt: "2026-08-08T14:49:00+09:00",
            title: "삼성8481승인 이*규",
            text:
              "78,120원 일시불\n08/08 13:33 신세계사우스시티\n누적280,170원",
          },
        }),
      }),
    ).resolves.toEqual({
      kind: "success",
      value: {
        observationId: "observation.android.kakao-forged-title",
        completion: "terminal",
      },
    });
    expect(subject.state().captured).toHaveLength(0);
  });

  it.each([
    {
      channel: "카카오톡",
      observationId: "observation.android.kakao-cumulative-only",
      packageName: "com.kakao.talk",
      notification: {
        postedAt: "2026-08-08T14:49:00+09:00",
        title: "삼성카드",
        text:
          "[이민규] [오후 2:49] 삼성8481승인 이*규\n" +
          "08/08 13:33 신세계사우스시티\n" +
          "누적280,170원",
      },
    },
    {
      channel: "SMS",
      observationId: "observation.android.sms-cumulative-only",
      packageName: "com.samsung.android.messaging",
      notification: {
        postedAt: "2026-08-08T14:49:00+09:00",
        title: "문자 메시지",
        textLines: [
          "삼성8481승인 이*규",
          "08/08 13:33 신세계사우스시티",
          "누적280,170원",
        ],
      },
    },
  ])(
    "$channel 삼성 알림에 거래금액 행 없이 누적만 있으면 저장하지 않는다",
    async ({ observationId, packageName, notification }) => {
      const subject = createSubject();

      await expect(
        subject.submit({
          actor,
          input: raw({ observationId, packageName, notification }),
        }),
      ).resolves.toEqual({
        kind: "success",
        value: { observationId, completion: "terminal" },
      });
      expect(subject.state().captured).toHaveLength(0);
      expect(subject.state().prefetched).toHaveLength(0);
    },
  );

  it("카카오톡으로 받은 삼성 승인 3건을 각각 정확한 거래로 변환한다", async () => {
    const subject = createSubject();
    const messages = [
      {
        observationId: "observation.android.kakao-samsung-198000",
        postedAt: "2026-08-08T14:48:00+09:00",
        headerTime: "오후 2:48",
        amount: "198,000",
        occurredTime: "13:23",
        cumulative: "198,000",
      },
      {
        observationId: "observation.android.kakao-samsung-4050",
        postedAt: "2026-08-08T14:48:30+09:00",
        headerTime: "오후 2:48",
        amount: "4,050",
        occurredTime: "13:26",
        cumulative: "202,050",
      },
      {
        observationId: "observation.android.kakao-samsung-78120",
        postedAt: "2026-08-08T14:49:00+09:00",
        headerTime: "오후 2:49",
        amount: "78,120",
        occurredTime: "13:33",
        cumulative: "280,170",
      },
    ] as const;

    for (const message of messages) {
      await subject.submit({
        actor,
        input: raw({
          observationId: message.observationId,
          packageName: "com.kakao.talk",
          notification: {
            postedAt: message.postedAt,
            title: "삼성카드",
            text:
              `[이민규] [${message.headerTime}] 삼성8481승인 이*규\n` +
              `${message.amount}원 일시불\n` +
              `08/08 ${message.occurredTime} 신세계사우스시티\n` +
              `누적${message.cumulative}원`,
          },
        }),
      });
    }

    const captures = subject.state().captured;
    expect(captures).toHaveLength(3);
    expect(
      captures.map((capture) => ({
        paymentKind: capture.paymentKind,
        amountInWon: capture.envelope.paymentObservation?.amountInWon,
        occurredLocalTime:
          capture.envelope.paymentObservation?.occurredLocalTime,
        merchant:
          capture.envelope.paymentObservation?.merchantEvidence.rawCandidate,
        cardEvidence: capture.envelope.paymentObservation?.cardEvidence,
      })),
    ).toEqual([
      {
        paymentKind: "card",
        amountInWon: 198_000,
        occurredLocalTime: "13:23",
        merchant: "신세계사우스시티",
        cardEvidence: { companyLabel: "삼성", maskedToken: "8481" },
      },
      {
        paymentKind: "card",
        amountInWon: 4_050,
        occurredLocalTime: "13:26",
        merchant: "신세계사우스시티",
        cardEvidence: { companyLabel: "삼성", maskedToken: "8481" },
      },
      {
        paymentKind: "card",
        amountInWon: 78_120,
        occurredLocalTime: "13:33",
        merchant: "신세계사우스시티",
        cardEvidence: { companyLabel: "삼성", maskedToken: "8481" },
      },
    ]);
    expect(
      captures.reduce(
        (sum, capture) =>
          sum + (capture.envelope.paymentObservation?.amountInWon ?? 0),
        0,
      ),
    ).toBe(280_170);
  });

  it("카카오톡 삼성 승인취소를 approval이 아닌 cancellation branch로 제출한다", async () => {
    const subject = createSubject();

    await subject.submit({
      actor,
      input: raw({
        observationId: "observation.android.kakao-samsung-cancellation",
        packageName: "com.kakao.talk",
        notification: {
          postedAt: "2026-08-08T15:10:00+09:00",
          title: "삼성카드",
          text:
            "[이민규] [오후 3:10] 삼성8481승인취소 이*규\n" +
            "78,120원 일시불\n" +
            "08/08 15:09 신세계사우스시티\n" +
            "누적202,050원",
        },
      }),
    });

    expect(subject.state().captured).toHaveLength(1);
    expect(subject.state().captured[0]).toMatchObject({
      paymentKind: "card",
      envelope: {
        sourceEvidence: {
          packageName: "com.kakao.talk",
          sourceType: "kakao-talk-financial-message",
        },
        parser: { parserId: "kakao-talk-financial-message-parser" },
        paymentObservation: {
          observationType: "cancellation",
          amountInWon: 78_120,
          occurredLocalDate: "2026-08-08",
          occurredLocalTime: "15:09",
          merchantEvidence: { rawCandidate: "신세계사우스시티" },
          cardEvidence: { companyLabel: "삼성", maskedToken: "8481" },
        },
      },
    });
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
    expect(subject.state().prefetched).toHaveLength(0);
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

    expect(subject.state().captured[0]).toMatchObject({
      paymentKind: "bill",
      envelope: {
        sourceEvidence: {
          packageName: "com.kakao.talk",
          sourceType: "kakao-talk-financial-message",
        },
        parser: {
          parserId: "kakao-talk-financial-message-parser",
          parserVersion: "1.0.0",
        },
      },
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
