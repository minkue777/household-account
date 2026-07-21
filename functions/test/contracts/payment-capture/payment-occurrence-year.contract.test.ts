import Ajv, { type AnySchema } from "ajv";
import { describe, expect, it } from "vitest";

import { readContractJson } from "../../support/contract-json";
import {
  readPaymentOccurrenceYearFixture,
  type PaymentOccurrenceYearFixtureCase,
} from "../../support/payment-occurrence-year-fixture";

const schema = readContractJson<AnySchema>(
  "schemas/payment-capture/payment-occurrence-year.v1.schema.json",
);
const fixture = readPaymentOccurrenceYearFixture();

const expectedCaseIds = [
  "year-boundary-december-rolls-back",
  "same-day-future-minute-rolls-back",
  "exact-received-minute-keeps-current-year",
  "past-month-keeps-current-year",
  "leap-day-finds-nearest-valid-year",
  "invalid-month-zero",
  "invalid-month-thirteen",
  "invalid-april-thirty-first",
  "invalid-february-thirtieth",
  "invalid-hour-negative",
  "invalid-hour-twenty-four",
  "invalid-minute-negative",
  "invalid-minute-sixty",
  "utc-received-at",
  "seoul-offset-equivalent-received-at",
] as const;

describe("결제 발생 연도 추론 fixture v1", () => {
  it("[T-PARSE-003][T-PARSE-TIME-001] fixture가 versioned JSON Schema를 만족한다", () => {
    const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

    expect(
      validate(fixture),
      JSON.stringify(validate.errors, null, 2),
    ).toBe(true);
  });

  it("[T-PARSE-003] 확정된 연도·윤년·유효성 경계 사례를 중복 없이 보존한다", () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.policy).toBe("payment-occurrence-year");

    const caseIds = fixture.cases.map(({ caseId }) => caseId);
    expect(new Set(caseIds).size).toBe(caseIds.length);
    expect([...caseIds].sort()).toEqual([...expectedCaseIds].sort());
  });

  it("[T-PARSE-TIME-001] 동등성 그룹은 같은 Instant의 서로 다른 offset 표현만 참조한다", () => {
    const casesById = new Map(
      fixture.cases.map((testCase) => [testCase.caseId, testCase]),
    );

    expect(fixture.equivalenceGroups).toHaveLength(1);

    for (const group of fixture.equivalenceGroups) {
      const groupedCases = group.caseIds.map((caseId) => casesById.get(caseId));

      expect(groupedCases.every((testCase) => testCase !== undefined)).toBe(
        true,
      );

      const existingCases = groupedCases.filter(
        (testCase): testCase is PaymentOccurrenceYearFixtureCase =>
          testCase !== undefined,
      );
      const receivedInstants = existingCases.map(({ input }) =>
        Date.parse(input.receivedAt),
      );
      const receivedAtRepresentations = existingCases.map(
        ({ input }) => input.receivedAt,
      );

      expect(new Set(receivedInstants).size).toBe(1);
      expect(receivedInstants.every(Number.isFinite)).toBe(true);
      expect(new Set(receivedAtRepresentations).size).toBe(
        receivedAtRepresentations.length,
      );
      expect(new Set(existingCases.map(({ expected }) => JSON.stringify(expected))).size).toBe(1);
    }
  });
});
