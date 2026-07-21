import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const docsRoot = join(workspaceRoot, "docs");

function markdownFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return extname(entry.name) === ".md" ? [path] : [];
  });
}

function localLinkTargets(markdown: string): string[] {
  return Array.from(markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g), (match) =>
    match[1].trim().replace(/^<|>$/g, ""),
  ).filter(
    (target) =>
      !target.startsWith("#") &&
      !/^(?:https?:|mailto:|tel:|data:)/i.test(target),
  );
}

describe("문서 상대 링크 배포 gate", () => {
  it("[T-REL-001][REL-001] docs의 모든 로컬 Markdown 링크는 존재하는 파일을 가리킨다", () => {
    const broken = markdownFiles(docsRoot).flatMap((file) =>
      localLinkTargets(readFileSync(file, "utf8")).flatMap((target) => {
        const withoutFragment = target.split("#", 1)[0].split("?", 1)[0];
        if (!withoutFragment) return [];

        let decoded: string;
        try {
          decoded = decodeURIComponent(withoutFragment);
        } catch {
          return [
            `${relative(workspaceRoot, file).replace(/\\/g, "/")}: 잘못 인코딩된 링크 ${target}`,
          ];
        }

        const resolved = resolve(dirname(file), decoded);
        return existsSync(resolved)
          ? []
          : [
              `${relative(workspaceRoot, file).replace(/\\/g, "/")}: ${target}`,
            ];
      }),
    );

    expect(broken).toEqual([]);
  });
});
