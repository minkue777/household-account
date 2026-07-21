import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../../");

function source(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

describe("배포 callable App Check 경계", () => {
  it.each([
    "functions/src/bootstrap/firebaseHouseholdCommand.ts",
    "functions/src/bootstrap/firebaseHouseholdQuery.ts",
    "functions/src/bootstrap/firebaseCaptureSubmission.ts",
    "functions/src/bootstrap/firebaseWebViewSession.ts",
  ])("%s는 인증과 별도로 App Check를 강제한다", (path) => {
    const value = source(path);
    expect(value).toMatch(/\.runWith\(\{[\s\S]*?enforceAppCheck:\s*true[\s\S]*?\}\)/u);
    expect(value).toContain(".https.onCall(");
  });

  it("Web과 Android가 각 배포 플랫폼의 App Check 공급자를 설치한다", () => {
    expect(
      source("web/src/platform/security/firebaseAppCheck.ts"),
    ).toContain("ReCaptchaEnterpriseProvider");
    expect(
      source(
        "android/app/src/main/java/com/household/account/HouseholdAccountApplication.kt",
      ),
    ).toContain("PlayIntegrityAppCheckProviderFactory");
  });
});
