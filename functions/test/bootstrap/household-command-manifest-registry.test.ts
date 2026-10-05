import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createFirebaseHouseholdCommandRegistry } from "../../src/bootstrap/householdCommandRegistry";
import { afterAll, describe, expect, it } from "vitest";

import {
  HOUSEHOLD_COMMAND_NAMES,
  createManifestBackedHouseholdCommandRegistry,
} from "../../src/bootstrap/commands/householdCommandManifest";
import type { HouseholdCommandHandler } from "../../src/bootstrap/commands/householdCommand";
import { readContractJson } from "../support/contract-json";

interface Manifest {
  readonly commands: readonly { readonly name: string; readonly scope: "principal" | "household" }[];
}

const app = initializeApp({ projectId: "demo-command-registry" }, "command-registry");
afterAll(() => deleteApp(app));

describe("household command runtime registry", () => {
  it("[T-CARD-005][CARD-005] 실제 서버 등록에는 일반 카드 복구 명령이 없다", () => {
    const names = [...createFirebaseHouseholdCommandRegistry(getFirestore(app)).keys()]
      .filter(name => name.startsWith("payment-configuration.") && /card/i.test(name));
    expect(names).toEqual([
      "payment-configuration.register-card.v1", "payment-configuration.update-card.v1",
      "payment-configuration.delete-card.v1", "payment-configuration.reorder-cards.v1",
    ]);
  });

  it("[T-CAT-003][CAT-002] 실제 서버에는 카테고리 재활성화·물리 삭제 명령이 없다", () => {
    const names = [...createFirebaseHouseholdCommandRegistry(getFirestore(app)).keys()]
      .filter(name => name.startsWith("category."));
    expect(names).toEqual([
      "category.create.v1",
      "category.update.v1",
      "category.archive.v1",
      "category.set-budget.v1",
      "category.reorder.v1",
      "category.set-default.v1"
]);
  });

  it("공개 manifest의 모든 command와 런타임 registry가 정확히 일치한다", () => {
    const manifest = readContractJson<Manifest>(
      "fixtures/system/household-command-manifest.v1.json",
    );

    const registry = createFirebaseHouseholdCommandRegistry(getFirestore(app));
    expect([...registry.keys()].sort()).toEqual(
      manifest.commands.map(({ name }) => name).sort(),
    );
    for (const command of manifest.commands) {
      expect(registry.get(command.name)?.access === "signed-in-user").toBe(command.scope === "principal");
    }
    expect([...registry].filter(([, handler]) => handler.access === "administrator").map(([name]) => name))
      .toEqual(["access.archive-asset-owner-profile.v1"]);
    expect([...registry].filter(([, handler]) => handler.idempotencyBoundary === "read-only").map(([name]) => name))
      .toEqual(["access.resolve-signed-in-user.v1"]);
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
