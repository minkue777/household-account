import { describe, expect, it } from "vitest";

import type { HouseholdQueryHandler } from "../../src/bootstrap/queries/householdQuery";
import {
  HOUSEHOLD_QUERY_NAMES,
  createManifestBackedHouseholdQueryRegistry,
} from "../../src/bootstrap/queries/householdQueryManifest";
import { readContractJson } from "../support/contract-json";

interface Manifest {
  readonly queries: readonly { readonly name: string }[];
}

describe("household query runtime registry", () => {
  const handler: HouseholdQueryHandler = { async execute() {} };

  it("공개 manifest의 모든 query와 런타임 registry가 정확히 일치한다", () => {
    const manifest = readContractJson<Manifest>(
      "fixtures/system/household-query-manifest.v1.json",
    );
    const registry = createManifestBackedHouseholdQueryRegistry(
      HOUSEHOLD_QUERY_NAMES.map((name) => [name, handler] as const),
    );

    expect([...registry.keys()].sort()).toEqual(
      manifest.queries.map(({ name }) => name).sort(),
    );
  });

  it("누락·비공개·중복 query handler는 composition 단계에서 실패한다", () => {
    expect(() => createManifestBackedHouseholdQueryRegistry([])).toThrow(
      /Public query handlers are missing/u,
    );
    expect(() =>
      createManifestBackedHouseholdQueryRegistry([
        ...HOUSEHOLD_QUERY_NAMES.map((name) => [name, handler] as const),
        ["internal.query.v1", handler] as const,
      ]),
    ).toThrow(/missing from the public manifest/u);
    expect(() =>
      createManifestBackedHouseholdQueryRegistry([
        ...HOUSEHOLD_QUERY_NAMES.map((name) => [name, handler] as const),
        [HOUSEHOLD_QUERY_NAMES[0], handler] as const,
      ]),
    ).toThrow(/registered more than once/u);
  });
});
