import Ajv, { type AnySchema } from "ajv";
import { describe, expect, it } from "vitest";

import { readContractJson } from "../../support/contract-json";

interface ContractCase {
  readonly caseId: string;
  readonly body: unknown;
}

interface Fixture {
  readonly validPayloads: readonly ContractCase[];
  readonly invalidPayloads: readonly ContractCase[];
  readonly validResults: readonly ContractCase[];
}

const payloadSchema = readContractJson<AnySchema>(
  "schemas/portfolio/portfolio-household-query-payloads.v1.schema.json",
);
const resultSchema = readContractJson<AnySchema>(
  "schemas/portfolio/portfolio-household-query-results.v1.schema.json",
);
const fixture = readContractJson<Fixture>(
  "fixtures/portfolio/portfolio-household-queries.v1.json",
);

describe("Portfolio household query wire contract", () => {
  it("accepts only the three public market/dividend query payload shapes", () => {
    const ajv = new Ajv({ allErrors: true, strict: true });
    const validate = ajv.compile(payloadSchema);

    for (const testCase of fixture.validPayloads) {
      expect(
        validate(testCase.body),
        `${testCase.caseId}: ${JSON.stringify(validate.errors)}`,
      ).toBe(true);
    }
    for (const testCase of fixture.invalidPayloads) {
      expect(validate(testCase.body), testCase.caseId).toBe(false);
    }
  });

  it("keeps search, quote, and dividend projections as stable typed results", () => {
    const ajv = new Ajv({ allErrors: true, strict: true });
    const validate = ajv.compile(resultSchema);

    for (const testCase of fixture.validResults) {
      expect(
        validate(testCase.body),
        `${testCase.caseId}: ${JSON.stringify(validate.errors)}`,
      ).toBe(true);
    }
  });
});
