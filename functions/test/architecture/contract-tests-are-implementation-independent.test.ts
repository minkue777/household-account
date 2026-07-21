import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const contextTestRoot = fileURLToPath(new URL("../contexts", import.meta.url));

function collectContractTests(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectContractTests(path);
    }

    return extname(entry.name) === ".ts" && entry.name.endsWith(".contract.test.ts")
      ? [path]
      : [];
  });
}

function importedModules(source: string): string[] {
  const matches = [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\s+["']([^"']+)["']/g),
    ...source.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']/g),
  ];

  return [...new Set(matches.map((match) => match[1]))];
}

function isAllowedProductionSeam(moduleName: string): boolean {
  const normalized = moduleName.replace(/\\/g, "/");

  return /(?:^|\/)src\/(?:contexts|platform|read-side|system)\/.+\/public(?:\.[cm]?[jt]s)?$/.test(
    normalized,
  );
}

describe("목표 계약 테스트 아키텍처", () => {
  it("업무 계약 suite는 SDK·내부 계층·현재 Web/Android 구현을 직접 import하지 않는다", () => {
    const violations: string[] = [];

    for (const file of collectContractTests(contextTestRoot)) {
      const source = readFileSync(file, "utf8");
      const displayPath = relative(contextTestRoot, file).replace(/\\/g, "/");

      for (const moduleName of importedModules(source)) {
        const normalized = moduleName.toLowerCase().replace(/\\/g, "/");
        const importsProduction = normalized.includes("/src/");
        const importsSdk =
          normalized.startsWith("firebase") ||
          normalized.startsWith("@firebase/") ||
          normalized.startsWith("react") ||
          normalized.includes("android");
        const importsInternalLayer =
          normalized.includes("/domain/") ||
          normalized.includes("/application/") ||
          normalized.includes("/adapters/");

        if (
          importsSdk ||
          importsInternalLayer ||
          (importsProduction && !isAllowedProductionSeam(moduleName))
        ) {
          violations.push(`${displayPath}: ${moduleName}`);
        }
      }

      if (
        /\b(?:vi|jest)\.(?:mock|spyOn)\s*\(|toHaveBeenCalled|\.mock\.calls|mockImplementation/.test(
          source,
        )
      ) {
        violations.push(`${displayPath}: 구현 호출·mock 상호작용 assertion`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("각 업무 계약 파일은 교체 가능한 Subject 경계를 명시한다", () => {
    const violations = collectContractTests(contextTestRoot).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const displayPath = relative(contextTestRoot, file).replace(/\\/g, "/");
      const missing: string[] = [];

      if (!/export\s+interface\s+\w*Subject\b/.test(source)) {
        missing.push("exported Subject interface");
      }
      if (!/export\s+function\s+createSubject\s*\(/.test(source)) {
        missing.push("createSubject factory");
      }
      if (!/describe(?:\.skip)?\s*\(/.test(source)) {
        missing.push("contract suite");
      }

      return missing.length === 0
        ? []
        : [`${displayPath}: ${missing.join(", ")}`];
    });

    expect(violations).toEqual([]);
  });

  it("각 업무 계약 파일은 빈 골격이 아니라 공개 결과를 assertion한다", () => {
    const violations = collectContractTests(contextTestRoot).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const displayPath = relative(contextTestRoot, file).replace(/\\/g, "/");

      if (!/\bexpect\s*\(/.test(source)) {
        return [`${displayPath}: expect assertion 없음`];
      }

      if (
        /expect\s*\(\s*true\s*\)\.toBe\s*\(\s*true\s*\)/.test(source) ||
        /expect\s*\(\s*false\s*\)\.toBe\s*\(\s*false\s*\)/.test(source)
      ) {
        return [`${displayPath}: 결과와 무관한 상수 assertion`];
      }

      return [];
    });

    expect(violations).toEqual([]);
  });
});
