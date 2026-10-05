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

// 실제 구현·SDK의 입력과 결과를 검사할 수 있습니다. Subject/port 형식이나 폴더 위치를 강제하지 않습니다.
describe("계약 테스트 기본 검증", () => {
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
