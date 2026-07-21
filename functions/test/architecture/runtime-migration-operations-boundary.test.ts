import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const cli = readFileSync(resolve(root, "functions/scripts/migrate-runtime.mjs"), "utf8");
const functionIndex = readFileSync(resolve(root, "functions/src/index.ts"), "utf8");
const facade = readFileSync(
  resolve(root, "functions/src/bootstrap/firebaseFunctionFacade.ts"),
  "utf8",
);
const migrationBuilder = readFileSync(
  resolve(
    root,
    "functions/src/adapters/firebase/migration/firebaseRuntimeMigrationPlanBuilder.ts",
  ),
  "utf8",
);

function sourceFiles(path: string): string[] {
  return readdirSync(path).flatMap((entry) => {
    const candidate = resolve(path, entry);
    return statSync(candidate).isDirectory()
      ? sourceFiles(candidate)
      : candidate.endsWith(".ts") || candidate.endsWith(".tsx") || candidate.endsWith(".kt")
        ? [candidate]
        : [];
  });
}

describe("runtime migration 운영 경계", () => {
  it("migration runner는 배포 Functions export가 아니라 운영 CLI에서만 조립한다", () => {
    expect(cli).toContain("FirebaseRuntimeMigrationPlanBuilder");
    expect(cli).toContain("FirebaseRuntimeMigrationPersistence");
    expect(functionIndex).not.toMatch(/migrateRuntime|runtimeMigration|MigrationPlanBuilder/u);
    expect(facade).not.toMatch(/migrateRuntime|runtimeMigration|MigrationPlanBuilder/u);
    const clientAndPublicSources = [
      ...sourceFiles(resolve(root, "web/src")),
      ...sourceFiles(resolve(root, "android/app/src/main")),
      ...sourceFiles(resolve(root, "functions/src/bootstrap")),
      resolve(root, "functions/src/index.ts"),
    ];
    for (const file of clientAndPublicSources) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(
        /FirebaseRuntimeMigration|createRuntimeMigrationApplication/u,
      );
    }
  });

  it("CLI는 모든 scope와 동일 plan hash·명시 승인 플래그를 요구한다", () => {
    for (const argument of [
      "--project",
      "--household",
      "--migration-id",
      "--migration-kind",
      "--schema-scope",
      "--operator",
      "--plan-hash",
      "--confirm",
    ]) {
      expect(cli).toContain(argument);
    }
    expect(cli).toContain('argument("--confirm") === "APPLY"');
  });

  it("CLI 결과와 실패 로그에 raw household·operator·mapping manifest를 넣지 않는다", () => {
    const outputFunction = cli.slice(cli.indexOf("function safeOutput"), cli.indexOf("function validManifest"));
    expect(outputFunction).not.toContain("householdId");
    expect(outputFunction).not.toContain("operatorId");
    expect(outputFunction).not.toContain("mappings");
    expect(cli).not.toContain("console.log");
    expect(cli).not.toContain("console.error");
  });

  it("plan builder는 collector orchestration만 담당하고 context 내부 구현을 import하지 않는다", () => {
    expect(migrationBuilder.split(/\r?\n/u).length).toBeLessThan(400);
    expect(migrationBuilder).toContain("collectFinanceRuntimeMigration");
    expect(migrationBuilder).toContain(
      "collectPaymentConfigurationRuntimeMigration",
    );
    expect(migrationBuilder).toContain("collectPortfolioAssetRuntimeMigration");
    expect(migrationBuilder).toContain("collectPreferencesRuntimeMigration");
    expect(migrationBuilder).not.toMatch(
      /contexts\/.+\/(?:domain|application)\//u,
    );
    for (const file of sourceFiles(
      resolve(root, "functions/src/adapters/firebase/migration/collectors"),
    )) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(
        /contexts\/.+\/(?:domain|application)\//u,
      );
    }
  });
});
