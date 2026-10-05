import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const checkMode = process.argv.includes("--check");

function sourceFiles(directory, extensions) {
  const absolute = resolve(root, directory);
  const files = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const path = resolve(absolute, entry.name);
    if (entry.isDirectory()) {
      files.push(
        ...sourceFiles(relative(root, path), extensions),
      );
    } else if (
      entry.isFile() &&
      extensions.some((extension) => entry.name.endsWith(extension))
    ) {
      files.push(path);
    }
  }
  return files;
}

function display(path) {
  return relative(root, path).replaceAll("\\", "/");
}

const violations = [];
const webWriteNames = [
  "addDoc",
  "setDoc",
  "updateDoc",
  "deleteDoc",
  "writeBatch",
  "runTransaction",
];

for (const path of sourceFiles("web/src", [".ts", ".tsx"])) {
  if (display(path).includes("/__tests__/")) continue;
  const source = readFileSync(path, "utf8");
  if (!source.includes("firebase/firestore")) continue;
  const used = webWriteNames.filter((name) =>
    new RegExp(`\\b${name}\\b`).test(source),
  );
  if (used.length > 0) {
    violations.push({
      runtime: "web",
      path: display(path),
      reason: `Firestore 직접 write API: ${used.join(", ")}`,
    });
  }
}

const androidWritePattern =
  /\.(?:add|set|update|delete|runTransaction|batch)\s*\(/;
for (const path of sourceFiles("android/app/src/main", [".kt", ".java"])) {
  const source = readFileSync(path, "utf8");
  if (
    source.includes("com.google.firebase.firestore") &&
    androidWritePattern.test(source)
  ) {
    violations.push({
      runtime: "android",
      path: display(path),
      reason: "Firestore 직접 write 호출",
    });
  }
}

const byRuntime = Object.groupBy(violations, ({ runtime }) => runtime);
for (const runtime of Object.keys(byRuntime).sort()) {
  const items = byRuntime[runtime];
  process.stdout.write(`${runtime}: ${items.length}건\n`);
  for (const item of items) {
    process.stdout.write(`  - ${item.path}: ${item.reason}\n`);
  }
}

process.stdout.write(`총 런타임 경계 위반: ${violations.length}건\n`);
if (checkMode && violations.length > 0) process.exitCode = 1;
