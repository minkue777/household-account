import { describe, expect, it } from "vitest";

import {
  readPaymentOccurrenceYearFixture,
  type PaymentOccurrenceYearInput,
  type PaymentOccurrenceYearResult,
} from "../../../support/payment-occurrence-year-fixture";
import { resolvePaymentOccurrenceYear } from "../../../../src/contexts/payment-capture/intake/public";

export type { PaymentOccurrenceYearInput, PaymentOccurrenceYearResult };

export interface PaymentOccurrenceYearContractSubject {
  resolve(input: PaymentOccurrenceYearInput): PaymentOccurrenceYearResult;
}

export function createSubject(): PaymentOccurrenceYearContractSubject {
  return { resolve: resolvePaymentOccurrenceYear };
}

const fixture = readPaymentOccurrenceYearFixture();

const executableCases = fixture.cases.map((testCase) => ({
  ...testCase,
  testName: `[${testCase.requirementIds.join("][")}] ${testCase.description}`,
}));

describe("연도 없는 결제 시각 추론 공개 계약", () => {
  it.each(executableCases)("$testName", ({ input, expected }) => {
    expect(createSubject().resolve(input)).toEqual(expected);
  });

  it.each(fixture.equivalenceGroups)(
    "[T-PARSE-TIME-001] $description",
    ({ caseIds }) => {
      const casesById = new Map(
        fixture.cases.map((testCase) => [testCase.caseId, testCase]),
      );
      const inputs = caseIds.map((caseId) => {
        const testCase = casesById.get(caseId);
        if (testCase === undefined) {
          throw new Error(`fixture에 ${caseId} 사례가 없습니다.`);
        }
        return testCase.input;
      });

      const subject = createSubject();
      const results = inputs.map((input) => subject.resolve(input));

      expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(
        1,
      );
    },
  );
});
