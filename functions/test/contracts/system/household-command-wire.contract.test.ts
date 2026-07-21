import Ajv, { type AnySchema, type ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";

import { readContractJson } from "../../support/contract-json";

interface WireCase {
  readonly caseId: string;
  readonly body: unknown;
}

interface HouseholdCommandFixtureV1 {
  readonly fixtureVersion: 1;
  readonly validRequests: readonly WireCase[];
  readonly invalidRequests: readonly WireCase[];
  readonly validResponses: readonly WireCase[];
  readonly invalidResponses: readonly WireCase[];
}

const requestSchema = readContractJson<AnySchema>(
  "schemas/system/household-command.v1.schema.json",
);
const responseSchema = readContractJson<AnySchema>(
  "schemas/system/household-command-response.v1.schema.json",
);
const fixture = readContractJson<HouseholdCommandFixtureV1>(
  "fixtures/system/household-command.v1.json",
);

function compile(schema: AnySchema): ValidateFunction {
  return new Ajv({ allErrors: true, strict: true }).compile(schema);
}

function expectCases(
  validate: ValidateFunction,
  cases: readonly WireCase[],
  expected: boolean,
): void {
  for (const item of cases) {
    expect(
      validate(item.body),
      `${item.caseId}: ${JSON.stringify(validate.errors, null, 2)}`,
    ).toBe(expected);
  }
}

describe("Household Command callable wire 계약", () => {
  it("[T-SEC-001][SYS-001] 공통 envelope는 version·명령·멱등 key를 요구하고 client Actor 필드를 거부한다", () => {
    const validate = compile(requestSchema);

    expect(fixture.fixtureVersion).toBe(1);
    expectCases(validate, fixture.validRequests, true);
    expectCases(validate, fixture.invalidRequests, false);
  });

  it("[T-SEC-001][SYS-001] 응답은 typed result만 허용하고 Firebase 내부 오류를 노출하지 않는다", () => {
    const validate = compile(responseSchema);

    expectCases(validate, fixture.validResponses, true);
    expectCases(validate, fixture.invalidResponses, false);
    expect(JSON.stringify(fixture.validResponses).toLowerCase()).not.toContain(
      "stack",
    );
  });
});
