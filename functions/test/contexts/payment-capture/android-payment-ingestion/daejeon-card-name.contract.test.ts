import { describe, expect, it } from "vitest";
import { createAndroidProviderParser } from "../../../../src/contexts/payment-capture/android-payment-ingestion/public";

const source = { packageName: "kr.co.nmcs.daejeonpay", parserId: "daejeon-local-currency-parser" };
const postedAt = "2026-10-11T09:12:00+09:00";

describe("대전 카드 상품명과 가맹점 분리", () => {
  it.each([
    "온통대전 1Q체크카드", "온통대전 농협 체크카드", "온통대전 체크카드",
  ])("[T-PARSE-001][PARSE-DAEJEON-001] %s의 상품명과 무관하게 상세 승인과 잔액을 추출한다", title => {
    const text = `${title}(1357) 승인 1,700원 캐시백적립 170원 10/11 09:11 테스트 카페 잔액42,913원`;
    for (const notification of [
      { title, text }, { title, bigText: text }, { title, textLines: text.split(" ") },
      { title, text: text.replace(/ /g, "\r\n") },
    ]) {
      expect(createAndroidProviderParser().parse({ source, notification: { postedAt, ...notification }, clockNow: postedAt })).toEqual({
        kind: "Parsed", payment: {
          type: "approval", amountInWon: 1700, occurredLocalDate: "2026-10-11", occurredLocalTime: "09:11",
          merchant: "테스트 카페", cardCompany: "대전사랑카드", maskedCardToken: "1357", localCurrencyType: "daejeon",
        }, balance: { amountInWon: 42913, localCurrencyType: "daejeon" },
      });
    }
  });

  it.each(["온통대전 1Q체크카드", "온통대전 농협 체크카드", "대전사랑카드"])(
    "[T-PARSE-001][PARSE-DAEJEON-001] 가맹점 없는 fallback에서 %s 제목을 가맹점으로 사용하지 않는다", title => {
      expect(createAndroidProviderParser().parse({ source, notification: {
        postedAt, title, text: "승인 1,700원\n10/11 09:11\n잔액42,913원",
      }, clockNow: postedAt })).toMatchObject({ kind: "Parsed", payment: {
        merchant: "알수없음", amountInWon: 1700,
      } });
    },
  );

  it("[T-PARSE-001][PARSE-DAEJEON-001] 기존 줄 단위 fallback 가맹점과 번호를 보존한다", () => {
    expect(createAndroidProviderParser().parse({ source, notification: {
      postedAt, title: "온통대전 1Q체크카드", text: "온통대전 1Q체크카드(1357)\n승인 1,700원\n10/11 09:11\n테스트 약국\n잔액42,913원",
    }, clockNow: postedAt })).toMatchObject({ kind: "Parsed", payment: {
      merchant: "테스트 약국", amountInWon: 1700, maskedCardToken: "1357",
    } });
  });

  it("[T-PARSE-001][PARSE-DAEJEON-001] 충전 부족 안내는 승인을 만들지 않는다", () => {
    expect(createAndroidProviderParser().parse({ source, notification: {
      postedAt, title: "온통대전 1Q체크카드", text: "보유하신 온통대전 1Q체크카드 충전액이 부족하여 체크카드 계좌에서 결제됩니다.",
    }, clockNow: postedAt }).kind).toBe("Ignored");
  });
});
