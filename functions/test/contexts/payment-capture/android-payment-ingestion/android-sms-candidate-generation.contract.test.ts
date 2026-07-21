import { describe, expect, it } from "vitest";
import {
  createAndroidSmsCandidateDriver,
  type AndroidSmsCandidateInputPort,
} from "../../../support/sms-candidate-driver";

export interface AndroidSmsCandidateSubject
  extends AndroidSmsCandidateInputPort {}

export function createSubject(): AndroidSmsCandidateSubject {
  return createAndroidSmsCandidateDriver();
}

const kbRaw =
  "KB국민카드\n승인 12,300원\n07/19 10:15\n국민(1234)\n가맹점가";
const kbCancellationRaw =
  "KB국민카드\n취소 12,300원\n07/19 10:15\n국민(1234)\n가맹점가";

describe("Android SMS raw 후보 생성·parser 선택 공개 계약", () => {
  it.each([
    {
      name: "Google 메시지",
      packageName: "com.google.android.apps.messaging",
      textLines: ["010-0000-0000", "알림", ...kbRaw.split("\n")],
    },
    {
      name: "Samsung 메시지",
      packageName: "com.samsung.android.messaging",
      textLines: ["[Web발신]", ...kbRaw.split("\n")],
    },
    {
      name: "Android MMS",
      packageName: "com.android.mms",
      textLines: kbRaw.split("\n"),
    },
  ])(
    "[T-PARSE-001][T-PARSE-002][ING-006] $name raw envelope는 전체·첫 행 제거·첫 두 행 제거 후보를 그 순서로 만든다",
    ({ packageName, textLines }) => {
      const result = createSubject().capture({
        packageName,
        postedAt: "2026-07-19T10:16:00+09:00",
        textLines,
      });

      expect(result.candidates).toEqual([
        { ordinal: 0, removedLeadingLines: 0, body: textLines.join("\n") },
        {
          ordinal: 1,
          removedLeadingLines: 1,
          body: textLines.slice(1).join("\n"),
        },
        {
          ordinal: 2,
          removedLeadingLines: 2,
          body: textLines.slice(2).join("\n"),
        },
      ]);
    },
  );

  it("[T-PARSE-001][ING-006][ING-007] 앞 후보가 실패하고 첫 두 행 제거 후보에서 KB raw가 성공하면 그 결과만 선택한다", () => {
    const result = createSubject().capture({
      packageName: "com.google.android.apps.messaging",
      postedAt: "2026-07-19T10:16:00+09:00",
      textLines: ["010-0000-0000", "[Web발신]", ...kbRaw.split("\n")],
    });

    expect(result).toMatchObject({
      kind: "Parsed",
      selectedCandidate: {
        ordinal: 2,
        removedLeadingLines: 2,
        body: kbRaw,
      },
      parserId: "kb-card-parser",
      payment: {
        type: "approval",
        amountInWon: 12_300,
        merchant: "가맹점가",
      },
    });
  });

  it("[T-PARSE-001][ING-007] 한 후보에서 여러 형식처럼 보여도 계약 순서의 첫 성공 parser 하나만 공개한다", () => {
    const result = createSubject().capture({
      packageName: "com.samsung.android.messaging",
      postedAt: "2026-07-19T10:16:00+09:00",
      text: `${kbRaw}\n[NH카드] 7월 관리비 182,000원 정상 납부 완료`,
    });

    expect(result).toMatchObject({
      kind: "Parsed",
      parserId: "kb-card-parser",
      payment: { amountInWon: 12_300 },
    });
  });

  it("[T-PARSE-001][ING-006] 지원 SMS package라도 세 후보가 모두 결제 형식이 아니면 저장 후보를 만들지 않는다", () => {
    const result = createSubject().capture({
      packageName: "com.android.mms",
      postedAt: "2026-07-19T10:16:00+09:00",
      textLines: ["택배", "배송이 시작되었습니다.", "문의 0000-0000"],
    });

    expect(result).toMatchObject({
      kind: "Ignored",
      code: "NO_SUPPORTED_PAYMENT",
    });
    expect(result.candidates).toHaveLength(3);
    expect(result).not.toHaveProperty("payment");
  });

  it("[T-ING-003][ING-002] 미등록 메시지 package는 본문이 같아도 후보를 parser에 제출하지 않는다", () => {
    const result = createSubject().capture({
      packageName: "com.example.messages",
      postedAt: "2026-07-19T10:16:00+09:00",
      text: kbRaw,
    });

    expect(result).toEqual({
      kind: "Ignored",
      code: "UNSUPPORTED_SOURCE",
      candidates: [],
    });
  });

  it.each([
    {
      name: "한 행",
      text: "결제 형식 아님",
      expected: [
        { ordinal: 0, removedLeadingLines: 0, body: "결제 형식 아님" },
      ],
    },
    {
      name: "두 행",
      text: "첫 행\n둘째 행",
      expected: [
        { ordinal: 0, removedLeadingLines: 0, body: "첫 행\n둘째 행" },
        { ordinal: 1, removedLeadingLines: 1, body: "둘째 행" },
      ],
    },
  ])(
    "[T-PARSE-001][ING-006] $name 원문은 비어 있지 않은 제거 후보만 만든다",
    ({ text, expected }) => {
      const result = createSubject().capture({
        packageName: "com.android.mms",
        postedAt: "2026-07-19T10:16:00+09:00",
        text,
      });

      expect(result).toMatchObject({
        kind: "Ignored",
        code: "NO_SUPPORTED_PAYMENT",
        candidates: expected,
      });
    },
  );

  it("[T-PARSE-001][ING-006] SMS 원문의 빈 행을 제거하고 각 후보 행의 공백을 정규화한다", () => {
    const result = createSubject().capture({
      packageName: "com.android.mms",
      postedAt: "2026-07-19T10:16:00+09:00",
      text: "  안내  \n\n  결제 형식 아님  \n ",
    });

    expect(result.candidates).toEqual([
      { ordinal: 0, removedLeadingLines: 0, body: "안내\n결제 형식 아님" },
      { ordinal: 1, removedLeadingLines: 1, body: "결제 형식 아님" },
    ]);
  });

  it("[T-PARSE-001][ING-006][ING-007] 전체 후보가 먼저 성공하면 제거 후보보다 전체 후보를 선택한다", () => {
    const result = createSubject().capture({
      packageName: "com.android.mms",
      postedAt: "2026-07-19T10:16:00+09:00",
      text: kbRaw,
    });

    expect(result).toMatchObject({
      kind: "Parsed",
      selectedCandidate: {
        ordinal: 0,
        removedLeadingLines: 0,
        body: kbRaw,
      },
      parserId: "kb-card-parser",
    });
  });

  it("[T-PARSE-001][ING-006][ING-007] 앞 후보의 후순위 parser 성공은 뒤 후보의 선순위 parser보다 먼저 확정한다", () => {
    const billingRaw = "[NH카드] 7월 관리비 182,000원 정상 납부 완료";
    const result = createSubject().capture({
      packageName: "com.android.mms",
      postedAt: "2026-07-19T10:16:00+09:00",
      textLines: [billingRaw, "[Web발신]", ...kbRaw.split("\n")],
    });

    expect(result).toMatchObject({
      kind: "Parsed",
      selectedCandidate: {
        ordinal: 0,
        removedLeadingLines: 0,
      },
      parserId: "sms-card-bill-parser",
      payment: {
        type: "approval",
        amountInWon: 182_000,
        merchant: "7월 관리비",
      },
    });
  });

  it("[T-PARSE-002][ING-003][ING-006] 취소 parser 결과도 승인으로 바꾸지 않고 보존한다", () => {
    const result = createSubject().capture({
      packageName: "com.android.mms",
      postedAt: "2026-07-19T10:16:00+09:00",
      text: kbCancellationRaw,
    });

    expect(result).toMatchObject({
      kind: "Parsed",
      selectedCandidate: { ordinal: 0, body: kbCancellationRaw },
      parserId: "kb-card-parser",
      payment: {
        type: "cancellation",
        amountInWon: 12_300,
        merchant: "가맹점가",
      },
    });
  });
});
