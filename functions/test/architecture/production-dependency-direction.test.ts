import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const functionsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = resolve(functionsRoot, "src");
const moduleRoots = ["contexts", "read-side", "platform", "system"]
  .map((directory) => resolve(sourceRoot, directory))
  .filter(existsSync);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return extname(entry.name) === ".ts" ? [path] : [];
  });
}

function importedModules(source: string): string[] {
  return [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\s+["']([^"']+)["']/g),
    ...source.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']/g),
  ].map((match) => match[1]);
}

function displayPath(file: string): string {
  return relative(functionsRoot, file).replace(/\\/g, "/");
}

function resolvedImport(file: string, imported: string): string | undefined {
  if (!imported.startsWith(".")) return undefined;
  return resolve(dirname(file), imported).replace(/\\/g, "/");
}

function moduleIdentity(file: string): string | undefined {
  const path = relative(sourceRoot, file).replace(/\\/g, "/");
  const parts = path.split("/");
  if (parts[0] === "contexts" && parts.length >= 3) {
    const contextWithCapabilityModules = new Set([
      "household-finance",
      "payment-capture",
      "portfolio",
    ]);
    return parts
      .slice(0, contextWithCapabilityModules.has(parts[1]) ? 3 : 2)
      .join("/");
  }
  if (
    (parts[0] === "read-side" ||
      parts[0] === "platform" ||
      parts[0] === "system") &&
    parts.length >= 2
  ) {
    return parts.slice(0, 2).join("/");
  }
  return undefined;
}

const files = moduleRoots.flatMap(sourceFiles);

describe("Functions 목표 아키텍처 의존 방향", () => {
  it("Domain은 Application·Adapter·외부 SDK에 의존하지 않고 Application은 Adapter·SDK에 의존하지 않는다", () => {
    const violations: string[] = [];

    for (const file of files) {
      const path = file.replace(/\\/g, "/");
      const layer =
        path.includes("/domain/") ||
        path.includes("/calculations/") ||
        path.includes("/model/")
        ? "domain"
        : path.includes("/application/")
          ? "application"
          : undefined;
      if (layer === undefined) continue;

      for (const imported of importedModules(readFileSync(file, "utf8"))) {
        const target = resolvedImport(file, imported) ?? imported;
        const sdkDependency =
          imported.startsWith("firebase") ||
          imported.startsWith("@firebase/") ||
          imported.startsWith("react") ||
          imported.startsWith("next/");
        const outwardDependency =
          target.includes("/adapters/") ||
          (layer === "domain" && target.includes("/application/"));

        if (sdkDependency || outwardDependency) {
          violations.push(`${displayPath(file)} -> ${imported}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("다른 기능 모듈은 상대 모듈의 public.ts 이외 내부 파일을 직접 import하지 않는다", () => {
    const violations: string[] = [];

    for (const file of files) {
      const sourceModule = moduleIdentity(file);
      if (sourceModule === undefined) continue;

      for (const imported of importedModules(readFileSync(file, "utf8"))) {
        const target = resolvedImport(file, imported);
        if (target === undefined || !target.startsWith(sourceRoot.replace(/\\/g, "/"))) {
          continue;
        }
        const targetModule = moduleIdentity(target);
        if (
          targetModule !== undefined &&
          targetModule !== sourceModule &&
          !/\/public$/.test(target)
        ) {
          violations.push(`${displayPath(file)} -> ${imported}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("public.ts는 Outbound Port·Adapter·외부 SDK를 공개하지 않는다", () => {
    const violations = files.flatMap((file) => {
      if (!file.replace(/\\/g, "/").endsWith("/public.ts")) return [];

      return importedModules(readFileSync(file, "utf8"))
        .filter(
          (imported) =>
            imported.replace(/\\/g, "/").includes("/ports/out/") ||
            imported.replace(/\\/g, "/").includes("/adapters/") ||
            imported.startsWith("firebase") ||
            imported.startsWith("@firebase/"),
        )
        .map((imported) => `${displayPath(file)} -> ${imported}`);
    });

    expect(violations).toEqual([]);
  });
});
