import { describe, expect, it } from "vitest";
import { createProviderParserGoldenDriver } from "../../../support/provider-parser-golden-driver";
import { createAndroidRawNotificationSubmissionDriver } from "../../../support/raw-notification-submission-driver";

export interface GyeonggiCancellationContractSubject {
  parse: ReturnType<typeof createProviderParserGoldenDriver>["parse"];
  raw: ReturnType<typeof createAndroidRawNotificationSubmissionDriver>;
}

export function createSubject(): GyeonggiCancellationContractSubject {
  const parser = createProviderParserGoldenDriver();
  return { parse: input => parser.parse(input), raw: createAndroidRawNotificationSubmissionDriver() };
}

const packages = ["gov.gyeonggi.ggcard", "com.mobiletoong.gpay", "com.coocon.chakwallet"];
const postedAt = "2026-09-29T17:22:40+09:00";
const notification = (title: string) => ({ postedAt, title,
  text: "테스트약국\r\n희망화성지역화폐_특례시기념 총 보유 잔액 80,000원" });
const actor = { principalId: "uid", householdId: "household", actingMemberId: "member",
  capabilities: ["paymentCapture:submit" as const] };

describe("[T-PARSE-002][PARSE-GYEONGGI-001] 경기지역화폐 취소 계약", () => {
  it.each(packages)("%s의 취소 금액·가맹점·서울 게시 시각과 잔액을 함께 보존한다", packageName => {
    const result = createSubject().parse({
      source: { packageName, parserId: "gyeonggi-local-currency-parser" },
      notification: notification("결제 취소 4,000원"), clockNow: "2026-10-01T00:00:00Z",
    });
    expect(result).toEqual({ kind: "Parsed", payment: { type: "cancellation", amountInWon: 4000,
      merchant: "테스트약국", cardCompany: "경기지역화폐", localCurrencyType: "gyeonggi",
      occurredLocalDate: "2026-09-29", occurredLocalTime: "17:22", timeSource: "postedAt" },
      balance: { amountInWon: 80000, localCurrencyType: "gyeonggi" } });
  });

  it.each(["0", "-4,000", "4.5", "2,147,483,648", "4,000원 신청", "4,000원 실패"])(
    "잘못된 취소 %s는 승인으로 전환하지 않고 잔액만 보존한다", amount => {
      const result = createSubject().parse({
        source: { packageName: packages[0], parserId: "gyeonggi-local-currency-parser" },
        notification: { ...notification(`결제 취소 ${amount}원`),
          text: "테스트약국\n원 결제 4,000원\n총 보유 잔액 80,000원" }, clockNow: postedAt,
      });
      expect(result).toEqual({ kind: "Parsed", balance: { amountInWon: 80000, localCurrencyType: "gyeonggi" } });
    });

  it.each(["결제 취소 신청 4,000원", "결제 취소 4,000원 실패", "결제 취소 안내 4,000원"])(
    "완료되지 않은 %s를 거래로 만들지 않는다", title => {
      const result = createSubject().parse({
        source: { packageName: packages[0], parserId: "gyeonggi-local-currency-parser" },
        notification: { postedAt, title, text: "테스트약국" }, clockNow: postedAt,
      });
      expect(result.kind).toBe("Ignored");
    });

  it.each([...packages, "com.google.android.apps.messaging", "com.samsung.android.messaging", "com.android.mms"])(
    "[ING-006][ING-008] %s의 실제 raw 제출에 취소와 잔액 분기를 전달한다", async packageName => {
      const subject = createSubject().raw;
      await subject.submit({ actor, input: { contractVersion: "android-raw-notification.v1",
        observationId: "local-cancel", packageName, notification: notification("결제 취소 7,000원") } });
      expect(subject.state().captured).toHaveLength(1);
      expect(subject.state().captured[0].envelope).toMatchObject({
        parser: { parserVersion: packages.includes(packageName) ? "1.1.0" : "1.3.0" },
        paymentObservation: { observationType: "cancellation", amountInWon: 7000,
          merchantEvidence: { rawCandidate: "테스트약국" }, localCurrencyType: "gyeonggi" },
        balanceObservation: { balanceInWon: 80000, currencyType: "gyeonggi", observedAt: postedAt },
      });
    });
});
