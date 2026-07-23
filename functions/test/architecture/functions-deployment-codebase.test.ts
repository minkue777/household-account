import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");

function exportedNames(path: string): readonly string[] {
  const source = readFileSync(resolve(root, path), "utf8");
  return [...source.matchAll(/exports\.([A-Za-z][A-Za-z0-9]*)\s*=/gu)]
    .map((match) => match[1])
    .sort();
}

describe("Functions 대화형 배포 codebase 경계", () => {
  it("결제 수집과 Android 최초 세션 교환을 일반·예약 작업 graph와 분리한다", () => {
    const firebase = JSON.parse(
      readFileSync(resolve(root, "firebase.json"), "utf8"),
    ) as {
      functions: Array<{ source: string; codebase: string }>;
    };
    expect(firebase.functions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "functions", codebase: "default" }),
        expect.objectContaining({
          source: "functions-payment-capture",
          codebase: "payment-capture",
        }),
        expect.objectContaining({
          source: "functions-access-session",
          codebase: "access-session",
        }),
      ]),
    );

    expect(exportedNames("functions-payment-capture/index.js")).toEqual([
      "addExpenseFromMessage",
      "submitAndroidRawNotification",
      "submitCaptureEnvelope",
    ]);
    expect(exportedNames("functions-access-session/index.js")).toEqual([
      "createWebViewSessionToken",
    ]);

    const defaultIndex = readFileSync(
      resolve(root, "functions/src/index.ts"),
      "utf8",
    );
    for (const interactive of [
      "addExpenseFromMessage",
      "submitAndroidRawNotification",
      "submitCaptureEnvelope",
      "createWebViewSessionToken",
    ]) {
      expect(defaultIndex).not.toContain(interactive);
    }
  });
});
