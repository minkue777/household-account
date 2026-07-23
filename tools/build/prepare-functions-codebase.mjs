import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const targetName = process.argv[2];

if (!targetName || !/^functions-[a-z0-9-]+$/u.test(targetName)) {
  throw new Error("준비할 Functions codebase 디렉터리가 필요합니다.");
}

const source = resolve(root, "functions", "lib");
const targetRoot = resolve(root, targetName);
const target = resolve(targetRoot, "lib", "core");

await rm(resolve(targetRoot, "lib"), { recursive: true, force: true });
await mkdir(resolve(targetRoot, "lib"), { recursive: true });
await cp(source, target, { recursive: true });
