import { describe, expect, it } from "vitest";

import {
  HOUSEHOLD_COMMAND_NAMES,
  createManifestBackedHouseholdCommandRegistry,
} from "../../src/bootstrap/commands/householdCommandManifest";
import type { HouseholdCommandHandler } from "../../src/bootstrap/commands/householdCommand";
import { readContractJson } from "../support/contract-json";

interface Manifest {
  readonly commands: readonly { readonly name: string }[];
}

describe("household command runtime registry", () => {
  it("공개 manifest의 모든 command와 런타임 registry가 정확히 일치한다", () => {
    const manifest = readContractJson<Manifest>(
      "fixtures/system/household-command-manifest.v1.json",
    );

    expect([...HOUSEHOLD_COMMAND_NAMES].sort()).toEqual(
      manifest.commands.map(({ name }) => name).sort(),
    );
    const handler: HouseholdCommandHandler = { async execute() {} };
    const registry = createManifestBackedHouseholdCommandRegistry(
      HOUSEHOLD_COMMAND_NAMES.map((name) => [name, handler] as const),
    );
    expect([...registry.keys()].sort()).toEqual(
      manifest.commands.map(({ name }) => name).sort(),
    );
  });

  it("구현되지 않은 공개 command가 있으면 composition 단계에서 즉시 실패한다", () => {
    expect(() => createManifestBackedHouseholdCommandRegistry([])).toThrow(
      /Public command handlers are missing/u,
    );
  });

  it("manifest에 없는 handler가 조용히 추가되는 것을 거부한다", () => {
    const handler: HouseholdCommandHandler = { async execute() {} };

    expect(() =>
      createManifestBackedHouseholdCommandRegistry([
        ["internal.unknown.v1", handler] as const,
      ]),
    ).toThrow(/missing from the public manifest/u);
  });

  it("같은 공개 command handler의 중복 등록을 거부한다", () => {
    const handler: HouseholdCommandHandler = { async execute() {} };
    const entries = HOUSEHOLD_COMMAND_NAMES.map(
      (name) => [name, handler] as const,
    );

    expect(() =>
      createManifestBackedHouseholdCommandRegistry([
        ...entries,
        [HOUSEHOLD_COMMAND_NAMES[0], handler] as const,
      ]),
    ).toThrow(/registered more than once/u);
  });
});
