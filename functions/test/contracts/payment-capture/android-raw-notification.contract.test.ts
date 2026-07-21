import Ajv, { type AnySchema } from "ajv";
import { describe, expect, it } from "vitest";

import { readContractJson } from "../../support/contract-json";

interface RawFixture {
  readonly fixtureVersion: 1;
  readonly contractVersion: "android-raw-notification.v1";
  readonly cases: readonly {
    readonly caseId: string;
    readonly requirementIds: readonly string[];
    readonly input: unknown;
  }[];
}

const schema = readContractJson<AnySchema>(
  "schemas/payment-capture/android-raw-notification.v1.schema.json",
);
const fixture = readContractJson<RawFixture>(
  "fixtures/payment-capture/android-raw-notification.v1.json",
);

describe("AndroidRawNotification.v1 producer·consumer 계약", () => {
  it("[T-ING-001][T-ING-003] golden raw 입력은 strict 공유 schema를 통과한다", () => {
    const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

    expect(fixture.fixtureVersion).toBe(1);
    expect(fixture.contractVersion).toBe("android-raw-notification.v1");
    for (const testCase of fixture.cases) {
      expect(validate(testCase.input), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("[DEC-066] client parser·source·가구·생성자 주입을 schema 단계에서 거부한다", () => {
    const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);
    const input = fixture.cases[0].input as Record<string, unknown>;

    for (const field of ["parserId", "sourceType", "householdId", "createdBy"]) {
      expect(validate({ ...input, [field]: "spoofed" })).toBe(false);
    }
  });
});
