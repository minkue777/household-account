import { readContractJson } from "./contract-json";

export interface PaymentOccurrenceYearInput {
  month: number;
  day: number;
  hour: number;
  minute: number;
  receivedAt: string;
  zoneId: "Asia/Seoul";
}

export type PaymentOccurrenceYearResult =
  | {
      kind: "success";
      occurredLocalDateTime: string;
    }
  | {
      kind: "parseFailure";
      code: "INVALID_DATE" | "INVALID_TIME";
    };

export interface PaymentOccurrenceYearFixtureCase {
  caseId: string;
  requirementIds: ("T-PARSE-003" | "T-PARSE-TIME-001")[];
  description: string;
  input: PaymentOccurrenceYearInput;
  expected: PaymentOccurrenceYearResult;
}

export interface PaymentOccurrenceYearFixtureV1 {
  schemaVersion: 1;
  policy: "payment-occurrence-year";
  cases: PaymentOccurrenceYearFixtureCase[];
  equivalenceGroups: {
    groupId: string;
    requirementIds: ["T-PARSE-TIME-001"];
    description: string;
    caseIds: string[];
  }[];
}

export function readPaymentOccurrenceYearFixture(): PaymentOccurrenceYearFixtureV1 {
  return readContractJson<PaymentOccurrenceYearFixtureV1>(
    "fixtures/payment-capture/payment-occurrence-year.v1.json",
  );
}
