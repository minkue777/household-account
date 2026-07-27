import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../../");

function source(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function exportedCallable(
  relativePath: string,
  exportName: string,
): string {
  const value = source(relativePath);
  const start = value.indexOf(`export const ${exportName} =`);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextExport = value.indexOf("\nexport const ", start + 1);
  return value.slice(start, nextExport < 0 ? undefined : nextExport);
}

describe("배포 callable App Check 경계", () => {
  it.each([
    [
      "functions/src/bootstrap/firebaseCaptureSubmission.ts",
      "submitCaptureEnvelope",
    ],
    [
      "functions/src/bootstrap/firebaseCaptureSubmission.ts",
      "submitAndroidRawNotification",
    ],
    [
      "functions/src/bootstrap/firebaseNotificationDiagnostic.ts",
      "submitNotificationDiagnostic",
    ],
    [
      "functions/src/bootstrap/firebaseWebViewSession.ts",
      "createWebViewSessionToken",
    ],
  ])("%s의 %s는 인증과 별도로 App Check를 강제한다", (path, exportName) => {
    const value = exportedCallable(path, exportName);
    expect(value).toMatch(/\.runWith\(\{[\s\S]*?enforceAppCheck:\s*true[\s\S]*?\}\)/u);
    expect(value).toContain(".https.onCall(");
    expect(value).not.toMatch(/minInstances\s*:/u);
  });

  it("Native Android가 Play Integrity App Check 공급자를 설치한다", () => {
    expect(
      source(
        "android/app/src/main/java/com/household/account/HouseholdAccountApplication.kt",
      ),
    ).toContain("PlayIntegrityAppCheckProviderFactory");
  });

  it("관리자 callable은 검증된 systemAdmin claim을 경계로 사용하고 App Check를 중복 강제하지 않는다", () => {
    const value = source(
      "functions/src/bootstrap/firebaseAdminAccess.ts",
    );
    expect(value).toContain("verifiedSystemAdministrator(");
    expect(value).not.toMatch(/enforceAppCheck:\s*true/u);
  });

  it("공용 Command와 Query callable은 Auth·Membership을 경계로 사용하고 불안정한 WebView App Check를 중복 강제하지 않는다", () => {
    for (const path of [
      "functions/src/bootstrap/firebaseHouseholdCommand.ts",
      "functions/src/bootstrap/firebaseHouseholdQuery.ts",
    ]) {
      const value = source(path);
      expect(value).toContain("principalUid: context.auth?.uid");
      expect(value).not.toMatch(/enforceAppCheck:\s*true/u);
      expect(value).not.toMatch(/minInstances\s*:/u);
    }
  });
});
