import Ajv, { type AnySchema } from "ajv";
import { describe, expect, it } from "vitest";

import { readContractJson } from "../../support/contract-json";

interface WireCase {
  readonly caseId: string;
  readonly body: unknown;
}

interface QueryFixture {
  readonly validRequests: readonly WireCase[];
  readonly invalidRequests: readonly WireCase[];
  readonly validResponses: readonly WireCase[];
  readonly invalidResponses: readonly WireCase[];
}

const requestSchema = readContractJson<AnySchema>(
  "schemas/system/household-query.v1.schema.json",
);
const responseSchema = readContractJson<AnySchema>(
  "schemas/system/household-query-response.v1.schema.json",
);
const manifestSchema = readContractJson<AnySchema>(
  "schemas/system/household-query-manifest.v1.schema.json",
);
const fixture = readContractJson<QueryFixture>(
  "fixtures/system/household-query.v1.json",
);
const manifest = readContractJson<{
  readonly queries: readonly { readonly name: string }[];
}>("fixtures/system/household-query-manifest.v1.json");

describe("Household Query 공개 wire 계약", () => {
  it("[T-QE-003][QE-009] 유효한 최신 거래 Query와 정규 결과만 허용한다", () => {
    const ajv = new Ajv({ allErrors: true, strict: true });
    const validateRequest = ajv.compile(requestSchema);
    const validateResponse = ajv.compile(responseSchema);

    for (const testCase of fixture.validRequests) {
      expect(
        validateRequest(testCase.body),
        `${testCase.caseId}: ${JSON.stringify(validateRequest.errors)}`,
      ).toBe(true);
    }
    for (const testCase of fixture.validResponses) {
      expect(
        validateResponse(testCase.body),
        `${testCase.caseId}: ${JSON.stringify(validateResponse.errors)}`,
      ).toBe(true);
    }
  });

  it("[T-QE-003][QE-009] 가구 scope 누락·Actor 위조·내부 오류 정보 노출을 거부한다", () => {
    const ajv = new Ajv({ allErrors: true, strict: true });
    const validateRequest = ajv.compile(requestSchema);
    const validateResponse = ajv.compile(responseSchema);

    for (const testCase of fixture.invalidRequests) {
      expect(validateRequest(testCase.body), testCase.caseId).toBe(false);
    }
    for (const testCase of fixture.invalidResponses) {
      expect(validateResponse(testCase.body), testCase.caseId).toBe(false);
    }
  });

  it("[T-QE-003][QE-009] Android가 사용하는 Query 이름은 단일 manifest에 선언한다", () => {
    const validateManifest = new Ajv({ allErrors: true, strict: true }).compile(
      manifestSchema,
    );

    expect(validateManifest(manifest), JSON.stringify(validateManifest.errors)).toBe(true);
    expect(manifest.queries.map(({ name }) => name)).toEqual([
      "ledger.get-transaction.v1",
      "shortcut.get-credential-status.v1",
      "portfolio.search-instruments.v1",
      "portfolio.get-instrument-quote.v1",
      "portfolio.get-dividend-projection.v1",
      "access.list-asset-owner-profiles.v1",
    ]);
  });
});
