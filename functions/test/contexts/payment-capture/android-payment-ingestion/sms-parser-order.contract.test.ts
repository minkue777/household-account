import { afterEach, describe, expect, it, vi } from "vitest";
import { createAndroidProviderParser } from "../../../../src/contexts/payment-capture/android-payment-ingestion/public";
import { resolvePaymentOccurrenceYear } from "../../../../src/contexts/payment-capture/intake/public";
import { kbCardProviderParser, nhPayProviderParser, payboocProviderParser, samsungCardProviderParser, lotteCardProviderParser } from "../../../../src/contexts/payment-capture/android-payment-ingestion/domain/parsers/cardProviderParsers";
import { naverPayProviderParser, tossBankProviderParser, kakaoPayProviderParser, digitalOnnuriProviderParser } from "../../../../src/contexts/payment-capture/android-payment-ingestion/domain/parsers/walletProviderParsers";
import { gyeonggiLocalCurrencyProviderParser, daejeonLocalCurrencyProviderParser } from "../../../../src/contexts/payment-capture/android-payment-ingestion/domain/parsers/localCurrencyProviderParsers";

const clockNow = "2026-07-19T20:01:00+09:00";
const parse = (text: string) => createAndroidProviderParser().parse({
  source: { packageName: "com.samsung.android.messaging", parserId: "sms-card-message-parser" },
  notification: { text, postedAt: clockNow }, clockNow,
});
const bill = "[NH농협카드]\n07월분 아파트관리비 182,000원\n카드 정상(승인)납부 완료.";
afterEach(() => vi.restoreAllMocks());

describe("실제 SMS parser 순서", () => {
  it("[T-SMS-ORDER-001][ING-007] 같은 본문을 KB와 NH가 모두 해석할 때 KB 결과로 중단한다", () => {
    const text = "KB국민카드1234 승인\nNH카드 5678 승인\n12,300원 일시불\n07/19 10:15\n가맹점가";
    const context = { title: "", body: text, postedAt: clockNow, clockNow, resolveOccurrenceYear: resolvePaymentOccurrenceYear };
    const kb = kbCardProviderParser.parse(context);
    const nh = nhPayProviderParser.parse(context);
    expect(kb).toMatchObject({ kind: "Parsed", payment: { cardCompany: "국민", maskedCardToken: "1234" } });
    expect(nh).toMatchObject({ kind: "Parsed", payment: { cardCompany: "농협", maskedCardToken: "5678" } });
    const next = vi.spyOn(nhPayProviderParser, "parse");
    expect(parse(text)).toEqual(kb);
    expect(next).not.toHaveBeenCalled();
  });

  it("[T-SMS-ORDER-001][ING-007] 실제 공급자 함수를 정해진 순서로 호출하고 전부 실패하면 무시한다", () => {
    const parsers = [kbCardProviderParser, nhPayProviderParser, naverPayProviderParser, tossBankProviderParser,
      kakaoPayProviderParser, digitalOnnuriProviderParser, payboocProviderParser, samsungCardProviderParser,
      lotteCardProviderParser, gyeonggiLocalCurrencyProviderParser, daejeonLocalCurrencyProviderParser];
    const calls: string[] = [];
    for (const parser of parsers) {
      const original = parser.parse;
      vi.spyOn(parser, "parse").mockImplementation(context => {
        calls.push(parser.parserId);
        return original(context);
      });
    }
    expect(parse("경기지역화폐 대전사랑카드 문자 형식 미일치")).toEqual({ kind: "Ignored", code: "NOT_COMPLETED_PAYMENT" });
    expect(calls).toEqual(parsers.map(parser => parser.parserId));
  });

  it("[T-SMS-ORDER-001][ING-007] 카드 승인과 청구 완료가 겹치면 카드 승인을 먼저 선택한다", () => {
    const result = parse("삼성1234승인\n12,300원 일시불\n07/19 10:15 가맹점가\n" + bill);
    expect(result).toMatchObject({ kind: "Parsed", payment: { cardCompany: "삼성", amountInWon: 12300 } });
  });

  it("[T-SMS-ORDER-001][ING-007] 일반 카드가 실패한 청구 완료는 실제 청구 parser로 해석한다", () => {
    expect(parse(bill)).toMatchObject({ kind: "Parsed", payment: { cardCompany: "농협", amountInWon: 182000, merchant: "07월분 아파트관리비" } });
  });

  it.each([
    ["경기지역화폐", "gyeonggi"], ["대전사랑카드", "daejeon"],
  ])("[T-SMS-ORDER-001][ING-007] %s 발신 근거가 있는 문자만 해당 지역으로 해석한다", (service, type) => {
    expect(parse(`${service}\n결제 완료 8,000원\n가맹점너\n잔액 32,000원`)).toMatchObject({
      kind: "Parsed", payment: { amountInWon: 8000, localCurrencyType: type },
      balance: { amountInWon: 32000, localCurrencyType: type },
    });
    expect(parse("결제 완료 8,000원\n가맹점너\n잔액 32,000원")).toEqual({ kind: "Ignored", code: "NOT_COMPLETED_PAYMENT" });
  });

  it("[T-SMS-ORDER-001][ING-007] 여민전 형식은 전용 parser만 지원하며 SMS 내부에는 추가하지 않는다", () => {
    const text = "결제 완료 8,000원\n가맹점너\n여민전 총 보유 잔액 32,000원";
    expect(createAndroidProviderParser().parse({
      source: { packageName: "gov.sejong.yeominpay", parserId: "sejong-local-currency-parser" },
      notification: { text, postedAt: clockNow }, clockNow,
    })).toMatchObject({ kind: "Parsed", balance: { amountInWon: 32000 } });
    expect(parse(text)).toEqual({ kind: "Ignored", code: "NOT_COMPLETED_PAYMENT" });
  });
});
