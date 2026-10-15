import { describe, expect, it } from "vitest";
import { createAndroidProviderParser } from "../../../../src/contexts/payment-capture/android-payment-ingestion/public";

const source = { packageName: "viva.republica.toss", parserId: "toss-bank-parser" };
const title = "11,512원 결제 완료";
const text = "토스뱅크 ・ 토스쇼핑\n결제한 돈 일부를 돌려받을 수 있어요.";
const postedAt = "2026-09-07T06:55:57.398Z";
const parse = (notification: { title?: string; text?: string; bigText?: string; textLines?: string[] }) =>
  createAndroidProviderParser().parse({ source, notification: { postedAt, ...notification }, clockNow: "2030-01-01T00:00:00Z" });

describe("토스 결제 완료 알림", () => {
  it.each([
    { title, text },
    { title, text: "축약 표시", bigText: text },
    { title, text: "축약 표시", bigText: "축약 표시", textLines: text.split("\n") },
    { text: `${title}\n${text}` },
    { title, text: text.replace(/\n/gu, "\r\n") },
  ])("[T-PARSE-001][PARSE-TOSS-001] 표시 필드에서 완료 금액·가맹점·수신 시각을 읽는다: %j", notification => {
    expect(parse(notification)).toEqual({ kind: "Parsed", payment: {
      type: "approval", amountInWon: 11_512, approvalAmountInWon: 11_512,
      merchant: "토스쇼핑", cardCompany: "토스", occurredLocalDate: "2026-09-07",
      occurredLocalTime: "15:55", timeSource: "postedAt",
    } });
  });

  it.each([
    { title: "11,512원 결제 실패", text },
    { title: "11,512원 결제 예정", text },
    { title: "11,512원 입금", text },
    { title: "115원 캐시백", text },
    { title: "결제 취소", text: "계좌 ・ 토스쇼핑" },
    { title, text: "토스뱅크 ・ " },
    { title, text: "국민카드 ・ 토스쇼핑" },
    { title, text: "토스페이머니 ・ 토스쇼핑" },
    { title: "쿠폰 알림", text: "(광고) 11,512원 결제 완료하면 혜택\n토스뱅크 ・ 토스쇼핑" },
    { title: "800원 출금", text: "내 토스뱅크 통장 → 9월교통카드이용" },
  ])("[T-PARSE-002][PARSE-TOSS-001] 승인 근거 없는 알림은 무시한다: %j", notification => {
    expect(parse(notification)).toEqual({ kind: "Ignored", code: "PARSE_FAILED" });
  });

  it("[T-PARSE-002][PARSE-TOSS-001] 가승인과 금액 범위 검증을 유지한다", () => {
    expect(parse({ title, text: "토스뱅크 ・ 가승인 상점" })).toEqual({ kind: "Ignored", code: "PREAUTHORIZATION" });
    expect(parse({ title: "2,147,483,648원 결제 완료", text })).toEqual({ kind: "Ignored", code: "INVALID_AMOUNT" });
  });
});
