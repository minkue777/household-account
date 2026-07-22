import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const requirementsRoot = join(workspaceRoot, "docs", "requirements");
const testRoots = [
  join(workspaceRoot, "functions", "test"),
  join(workspaceRoot, "web", "src", "__tests__"),
];

function listFiles(root: string, extension: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath, extension);
    return extname(entry.name) === extension ? [fullPath] : [];
  });
}

function canonicalTestDeclarations(): string[] {
  const declarationPattern = /^\|\s*(T-[A-Z0-9-]+)\s*\|/gm;
  return listFiles(requirementsRoot, ".md").flatMap((file) => {
    const contents = readFileSync(file, "utf8");
    return Array.from(contents.matchAll(declarationPattern), (match) => match[1]);
  });
}

function requirementSourceFiles(): string[] {
  return listFiles(requirementsRoot, ".md").filter((file) => {
    const path = relative(requirementsRoot, file).replace(/\\/g, "/");
    return (
      /^(?:contexts\/[^/]+\/modules|supporting-platform\/modules)\/[^/]+\/requirements\.md$/.test(
        path,
      ) || path === "system/context.md"
    );
  });
}

function moduleSpecificationFiles(): string[] {
  return listFiles(requirementsRoot, ".md").filter((file) => {
    const path = relative(requirementsRoot, file).replace(/\\/g, "/");
    return (
      /^(?:contexts\/[^/]+\/modules|supporting-platform\/modules)\/[^/]+\/(?:requirements|design)\.md$/.test(
        path,
      ) || path === "system/design.md"
    );
  });
}

interface RequirementDeclaration {
  id: string;
  file: string;
}

function requirementDeclarationEntries(): RequirementDeclaration[] {
  const declarationPattern =
    /^\|\s*\[?((?!T-)[A-Z][A-Z0-9-]*-\d{3})(?:\]\([^)]+\))?\s*\|/gm;
  const declarations: RequirementDeclaration[] = [];

  for (const file of requirementSourceFiles()) {
    const contents = readFileSync(file, "utf8");
    const requirementSection =
      contents.match(
        /## (?:5\. 요구사항|6\. 공통 요구사항)\s*\r?\n([\s\S]*?)(?=\r?\n## |$)/,
      )?.[1] ?? "";
    for (const match of requirementSection.matchAll(declarationPattern)) {
      declarations.push({
        id: match[1],
        file: relative(requirementsRoot, file).replace(/\\/g, "/"),
      });
    }
  }

  return declarations;
}

function requirementDeclarations(): ReadonlyMap<string, string> {
  return new Map(
    requirementDeclarationEntries().map(({ id, file }) => [id, file]),
  );
}

function lineReferencesRequirement(line: string, requirementId: string): boolean {
  if (
    new RegExp(
      `(?<![A-Z0-9-])${requirementId.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}(?![A-Z0-9-])`,
    ).test(line)
  ) {
    return true;
  }

  const idMatch = /^([A-Z][A-Z0-9-]*?)-(\d{3})$/.exec(
    requirementId,
  );
  if (!idMatch) return false;

  const [, prefix, number] = idMatch;
  const wildcardPattern = new RegExp(
    `(?<![A-Z0-9-])${prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}-\\*(?![A-Z0-9-])`,
  );
  if (wildcardPattern.test(line)) return true;

  for (const match of line.matchAll(
    /(?<![A-Z0-9-])([A-Z][A-Z0-9-]*?)-(\d{3})~(?:(?:[A-Z][A-Z0-9-]*?)-)?(\d{3})(?![A-Z0-9-])/g,
  )) {
    if (match[1] !== prefix) continue;
    const value = Number(number);
    if (value >= Number(match[2]) && value <= Number(match[3])) {
      return true;
    }
  }

  return false;
}

function requirementTestMappingLines(): string[] {
  return listFiles(requirementsRoot, ".md").flatMap((file) =>
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter(
        (line) =>
          line.startsWith("|") &&
          /(?<![A-Z0-9-])T-[A-Z0-9-]+(?![A-Z0-9-])/.test(line),
      ),
  );
}

function executableTestFiles(): string[] {
  return testRoots.flatMap((root) => [
    ...listFiles(root, ".ts"),
    ...listFiles(root, ".tsx"),
  ]);
}

function contractTestCorpus(): string {
  return executableTestFiles()
    .filter((file) => !file.endsWith("requirement-test-traceability.test.ts"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

function contractTestReferenceLines(): string[] {
  return executableTestFiles()
    .filter((file) => !/[\\/]architecture[\\/]/.test(file))
    .flatMap((file) => readFileSync(file, "utf8").split(/\r?\n/));
}

function contextContractTestCorpus(): string {
  return contractTestReferenceLines().join("\n");
}

describe("요구사항과 계약 테스트 추적성", () => {
  it("모듈 요구사항 ID는 한 소유 문서에서만 선언된다", () => {
    const declarations = requirementDeclarationEntries();
    const duplicates = declarations
      .filter(
        ({ id }, index) =>
          declarations.findIndex((declaration) => declaration.id === id) !==
          index,
      )
      .map(({ id }) => id);

    expect([...new Set(duplicates)]).toEqual([]);
  });

  it("Context·지원 영역 지도의 요구사항 합계는 하위 단일 소유 문서의 실제 선언 수와 일치한다", () => {
    const declarations = requirementDeclarationEntries();
    const maps = [
      "contexts/access-household",
      "contexts/household-finance",
      "contexts/notifications",
      "contexts/payment-capture",
      "contexts/portfolio",
      "supporting-platform",
    ];
    const violations: string[] = [];

    for (const mapPath of maps) {
      const mapFile = join(requirementsRoot, ...mapPath.split("/"), "requirements.md");
      const contents = readFileSync(mapFile, "utf8");
      const actual = declarations.filter(({ file }) =>
        file.startsWith(`${mapPath}/modules/`),
      ).length;
      const declared = Number(
        contents.match(/^> 소유 요구사항:.*?(\d+)개\s*$/m)?.[1],
      );
      const totalLine = contents
        .split(/\r?\n/)
        .find((line) => line.startsWith("| 합계 |"));
      const tableTotals = (totalLine ?? "")
        .split("|")
        .map((cell) => cell.trim())
        .filter((cell) => /^\d+$/.test(cell))
        .map(Number);
      const proseTotal = Number(contents.match(/^합계는\s*(\d+)개/m)?.[1]);
      const documentedTotals = tableTotals.length > 0 ? tableTotals : [proseTotal];

      if (declared !== actual) {
        violations.push(`${mapPath}: 머리말 ${declared}, 실제 ${actual}`);
      }
      if (documentedTotals.length !== 1 || documentedTotals[0] !== actual) {
        violations.push(
          `${mapPath}: 합계 행 ${documentedTotals.join(",") || "없음"}, 실제 ${actual}`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("Canonical 테스트 ID는 한 문서 행에서만 선언된다", () => {
    const declarations = canonicalTestDeclarations();
    const duplicates = declarations.filter(
      (id, index) => declarations.indexOf(id) !== index,
    );

    expect([...new Set(duplicates)]).toEqual([]);
  });

  it("문서에 선언된 모든 Canonical 테스트 ID는 실행 가능한 테스트 소스에 연결된다", () => {
    const corpus = contractTestCorpus();
    const missing = canonicalTestDeclarations()
      .filter((id) => !new RegExp(`(?<![A-Z0-9-])${id}(?![A-Z0-9-])`).test(corpus))
      .sort();

    expect(missing).toEqual([]);
  });

  it("테스트 소스가 참조하는 모든 Canonical 테스트 ID는 문서의 단일 소유 행에 선언돼 있다", () => {
    const declarations = new Set(canonicalTestDeclarations());
    const referenced = contractTestReferenceLines().flatMap((line) =>
      Array.from(
        line.matchAll(/(?<![A-Z0-9-])T-[A-Z0-9-]+(?![A-Z0-9-])/g),
        (match) => match[0],
      ),
    );
    const missing = [...new Set(referenced)]
      .filter((id) => !declarations.has(id))
      .sort();

    expect(missing).toEqual([]);
  });

  it("요구사항·설계 표에서 참조한 Canonical 테스트 ID는 반드시 선언돼 있다", () => {
    const declarations = new Set(canonicalTestDeclarations());
    const referenced = requirementTestMappingLines().flatMap((line) =>
      Array.from(
        line.matchAll(/(?<![A-Z0-9-])T-[A-Z0-9-]+(?![A-Z0-9-])/g),
        (match) => match[0],
      ),
    );
    const missing = [...new Set(referenced)]
      .filter((id) => !declarations.has(id))
      .sort();

    expect(missing).toEqual([]);
  });

  it("모든 모듈 요구사항은 Canonical 테스트 ID와 문서상 연결된다", () => {
    const mappings = requirementTestMappingLines();
    const missing = [...requirementDeclarations().keys()]
      .filter(
        (requirementId) =>
          !mappings.some((line) =>
            lineReferencesRequirement(line, requirementId),
          ),
      )
      .sort();

    expect(missing).toEqual([]);
  });

  it("모든 모듈 요구사항은 계약 테스트 본문의 assertion 시나리오에 직접 연결된다", () => {
    const corpus = contextContractTestCorpus();
    const missing = [...requirementDeclarations().keys()]
      .filter((requirementId) => !lineReferencesRequirement(corpus, requirementId))
      .sort();

    expect(missing).toEqual([]);
  });

  it("모듈 테스트 표에 구현되지 않은 '추가 예정' 항목을 남기지 않는다", () => {
    const pendingRows = moduleSpecificationFiles().flatMap((file) =>
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((line) => line.startsWith("|") && line.includes("| 추가 예정 |"))
        .map((line) => `${relative(requirementsRoot, file)}: ${line}`),
    );

    expect(pendingRows).toEqual([]);
  });

  it("미결정 정책이 0건이면 제품 결정을 기다리는 test.todo가 존재하지 않는다", () => {
    const pendingDecisions = readFileSync(
      join(requirementsRoot, "governance", "pending-decisions.md"),
      "utf8",
    );
    const corpus = contractTestCorpus();

    expect(pendingDecisions).toContain("현재 미결정 제품 정책 0건");
    expect(corpus).not.toMatch(/\btest\.todo\s*\(/);
  });
});
