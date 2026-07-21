import { readdirSync, readFileSync, statSync } from "node:fs";
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

const functionsEntryPath = resolve(root, "functions/src/index.ts");
if (statSync(functionsEntryPath).isFile()) {
  const entry = readFileSync(functionsEntryPath, "utf8");
  const legacyExports = [
    "./expenses",
    "./assets",
    "./dividends",
    "./households",
    "./notifications",
  ].filter((modulePath) => entry.includes(modulePath));
  if (legacyExports.length > 0) {
    violations.push({
      runtime: "functions",
      path: display(functionsEntryPath),
      reason: `flat legacy export: ${legacyExports.join(", ")}`,
    });
  }
}

const functionsFacadePath = resolve(
  root,
  "functions/src/bootstrap/firebaseFunctionFacade.ts",
);
if (statSync(functionsFacadePath).isFile()) {
  const facade = readFileSync(functionsFacadePath, "utf8");
  const legacyModules = [
    "../expenses",
    "../assets",
    "../dividends",
    "../households",
    "../notifications",
  ].filter((modulePath) => facade.includes(modulePath));
  if (legacyModules.length > 0) {
    violations.push({
      runtime: "functions",
      path: display(functionsFacadePath),
      reason: `bootstrap을 우회하는 legacy handler: ${legacyModules.join(", ")}`,
    });
  }
}

for (const misplaced of [
  "functions/src/platform/pwa",
  "functions/src/platform/android-host",
]) {
  try {
    if (statSync(resolve(root, misplaced)).isDirectory()) {
      violations.push({
        runtime: "placement",
        path: misplaced,
        reason: "실제 배포 단위(Web 또는 Android)로 이전되지 않은 참조 구현",
      });
    }
  } catch {
    // 목표 위치로 이전되어 경로가 사라진 정상 상태입니다.
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
