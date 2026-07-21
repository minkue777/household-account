import { describe, expect, it } from "vitest";
import {
  createShortcutValueNormalizer,
  type ShortcutValueNormalizerInputPort,
} from "../../../../src/contexts/payment-capture/shortcut-ingestion/public";

export interface ShortcutValueNormalizerContractSubject
  extends ShortcutValueNormalizerInputPort {}

export function createSubject(): ShortcutValueNormalizerContractSubject {
  return createShortcutValueNormalizer();
}

describe("Shortcut 입력값 정규화 공개 계약", () => {
  it.each([
    { input: "  결제 승인  ", expected: "결제 승인" },
    { input: 12_300, expected: "12300" },
    { input: true, expected: "true" },
    {
      input: [" 첫 줄 ", [null, "", "둘째 줄"], 3],
      expected: "첫 줄\n둘째 줄\n3",
    },
  ])(
    "[T-IOS-004][IOS-002] 문자열·원시값·중첩 배열을 안정적인 메시지로 정규화한다",
    ({ input, expected }) => {
      expect(createSubject().normalize(input)).toEqual({
        kind: "Normalized",
        value: expected,
      });
    },
  );

  it.each([
    {
      input: { value: "후순위", text: "두 번째", string: "첫 번째" },
      expected: "첫 번째",
    },
    {
      input: { PlainText: "다섯 번째", plainText: "네 번째" },
      expected: "네 번째",
    },
    {
      input: { string: " ", text: "사용 가능" },
      expected: "사용 가능",
    },
  ])(
    "[T-IOS-004][IOS-002] 알려진 객체는 string→text→value→plainText→PlainText 우선순위의 첫 비어 있지 않은 값을 사용한다",
    ({ input, expected }) => {
      expect(createSubject().normalize(input)).toEqual({
        kind: "Normalized",
        value: expected,
      });
    },
  );

  it("[T-IOS-004][IOS-002] 알려지지 않은 JSON 객체는 key 순서와 무관한 안정 문자열을 만든다", () => {
    const subject = createSubject();

    const first = subject.normalize({ z: 1, nested: { b: 2, a: 1 }, a: 3 });
    const second = subject.normalize({ a: 3, nested: { a: 1, b: 2 }, z: 1 });

    expect(first).toEqual(second);
    expect(first).toEqual({
      kind: "Normalized",
      value: '{"a":3,"nested":{"a":1,"b":2},"z":1}',
    });
  });

  it.each([null, undefined, "", "   ", [], [null, " "]])(
    "[T-IOS-004][IOS-002] 의미 있는 값이 없으면 Empty로 구분한다",
    (input) => {
      expect(createSubject().normalize(input)).toEqual({ kind: "Empty" });
    },
  );

  it("[T-IOS-004][IOS-002] 순환 객체는 예외나 임의 문자열 대신 Empty로 거부한다", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(createSubject().normalize(circular)).toEqual({ kind: "Empty" });
  });
});
