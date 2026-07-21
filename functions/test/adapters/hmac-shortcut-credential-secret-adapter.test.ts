import { describe, expect, it } from "vitest";

import { HmacShortcutCredentialSecretAdapter } from "../../src/adapters/firebase/payment-capture/firebaseShortcutCredentialInfrastructure";

describe("HMAC Shortcut credential secret adapter", () => {
  it("CSPRNG 원문과 비가역 HMAC만 만들고 원문에서 공개 credentialId만 복원한다", () => {
    const adapter = new HmacShortcutCredentialSecretAdapter({
      pepper: () => "a-secure-test-pepper-that-is-longer-than-32-bytes",
      keyVersion: () => "shortcut-hmac.v2",
      installUrl: () => "https://www.icloud.com/shortcuts/template-id",
    });

    const generated = adapter.generate();

    expect(generated.rawCredential).toMatch(/^hca-shortcut\.v1\./u);
    expect(generated.secretHash).toMatch(/^hmac-sha256:[0-9a-f]{64}$/u);
    expect(generated.secretHash).not.toContain(generated.rawCredential);
    expect(adapter.hash(generated.rawCredential)).toBe(generated.secretHash);
    expect(
      HmacShortcutCredentialSecretAdapter.credentialId(generated.rawCredential),
    ).toBe(generated.credentialId);
    expect(adapter.activeKeyVersion()).toBe("shortcut-hmac.v2");
    expect(adapter.installUrl()).toBe(
      "https://www.icloud.com/shortcuts/template-id",
    );
  });

  it("짧은 pepper와 비공식 설치 URL은 발급 전에 fail closed한다", () => {
    const weak = new HmacShortcutCredentialSecretAdapter({
      pepper: () => "too-short",
      keyVersion: () => undefined,
      installUrl: () => "https://example.com/not-a-shortcut",
    });

    expect(() => weak.generate()).toThrow(
      "SHORTCUT_CREDENTIAL_PEPPER_NOT_CONFIGURED",
    );
    expect(() => weak.installUrl()).toThrow(
      "SHORTCUT_INSTALL_URL_NOT_CONFIGURED",
    );
  });
});
