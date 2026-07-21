import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const script = readFileSync(
  resolve(__dirname, "../../scripts/reconcile-runtime.mjs"),
  "utf8",
);

describe("런타임 reconciliation 운영 경계", () => {
  it("기본 도구는 Firestore read만 수행하고 mutation API를 포함하지 않는다", () => {
    const firestoreSurface = script
      .split("\n")
      .filter((line) => !line.includes('createHash("sha256").update'))
      .join("\n");
    for (const forbidden of [
      ".set(",
      ".create(",
      ".update(",
      ".delete(",
      ".add(",
      ".runTransaction(",
      ".batch(",
    ]) {
      expect(firestoreSurface, forbidden).not.toContain(forbidden);
    }
    expect(script).toContain('mode: "READ_ONLY_RECONCILIATION"');
  });

  it("가구 ID 원문 대신 hash만 보고서에 포함한다", () => {
    expect(script).toContain("householdIdHash:");
    expect(script).not.toMatch(/\n\s*householdId,\n/);
  });
});
