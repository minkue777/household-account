import Ajv, { type AnySchema, type ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";

import { readContractJson } from "../../support/contract-json";

interface WireCase {
  caseId: string;
  body: unknown;
}

interface ShortcutPaymentWireFixtureV1 {
  fixtureVersion: 1;
  requirementIds: string[];
  validRequests: WireCase[];
  invalidRequests: WireCase[];
  validResponses: WireCase[];
  invalidResponses: WireCase[];
}

const requestSchema = readContractJson<AnySchema>(
  "schemas/payment-capture/shortcut-payment-request.v1.schema.json",
);
const responseSchema = readContractJson<AnySchema>(
  "schemas/payment-capture/shortcut-payment-response.v1.schema.json",
);
const fixture = readContractJson<ShortcutPaymentWireFixtureV1>(
  "fixtures/payment-capture/shortcut-payment-wire.v1.json",
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

describe("Shortcut payment HTTP wire contract", () => {
  it("[IOS-001][IOS-010][IOS-012] request는 message만 받고 Actor·가구 필드를 거부한다", () => {
    const validate = compile(requestSchema);

    expectCases(validate, fixture.validRequests, true);
    expectCases(validate, fixture.invalidRequests, false);
  });

  it("[IOS-008][IOS-009][IOS-012] 거래 결과와 알림 결과를 분리한 typed response만 허용한다", () => {
    const validate = compile(responseSchema);

    expectCases(validate, fixture.validResponses, true);
    expectCases(validate, fixture.invalidResponses, false);
  });

  it("[T-IOS-SEC-001] golden response는 원문·credential·내부 stack을 노출하지 않는다", () => {
    const serialized = JSON.stringify(fixture.validResponses).toLowerCase();

    expect(serialized).not.toContain('"message"');
    expect(serialized).not.toContain("credential");
    expect(serialized).not.toContain("stack");
    expect(serialized).not.toContain("token");
  });
});
