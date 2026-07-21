import Ajv, { type AnySchema } from "ajv";
import { describe, expect, it } from "vitest";

import { readContractJson } from "../../support/contract-json";

interface CommandManifest {
  readonly contractVersion: "household-command-manifest.v1";
  readonly commands: readonly {
    readonly name: string;
    readonly owner: string;
    readonly scope: "principal" | "household";
    readonly clients: readonly ("web" | "android")[];
  }[];
}

const schema = readContractJson<AnySchema>(
  "schemas/system/household-command-manifest.v1.schema.json",
);
const manifest = readContractJson<CommandManifest>(
  "fixtures/system/household-command-manifest.v1.json",
);

describe("Household Command 공개 manifest", () => {
  it("[T-SEC-001][SYS-001] 모든 client command는 owner·tenant scope·호출 client를 하나만 선언한다", () => {
    const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

    expect(validate(manifest), JSON.stringify(validate.errors, null, 2)).toBe(true);
    const names = manifest.commands.map(({ name }) => name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("[T-SEC-001][SYS-001] principal command allowlist에는 인증 전후 onboarding만 존재한다", () => {
    expect(
      manifest.commands
        .filter(({ scope }) => scope === "principal")
        .map(({ name }) => name)
        .sort(),
    ).toEqual(
      [
        "access.claim-legacy-membership.v1",
        "access.create-household-with-self.v1",
        "access.join-household-as-self.v1",
        "access.resolve-signed-in-user.v1",
      ].sort(),
    );
  });

  it("[T-SEC-001] migration·repair·snapshot·scheduler command는 일반 client surface에 노출하지 않는다", () => {
    const forbidden = /(migrate|repair|snapshot|reconcile|purge|admin)/u;

    expect(manifest.commands.map(({ name }) => name).filter((name) => forbidden.test(name))).toEqual([]);
  });

  it("[T-LED-010][LED-007] 명시적 가구원 알림 요청은 Notifications가 아니라 Ledger command다", () => {
    expect(
      manifest.commands.find(({ name }) => name === "ledger.request-notification.v1"),
    ).toMatchObject({ owner: "household-finance.ledger" });
    expect(
      manifest.commands.some(({ name }) => name === "notifications.request-partner-notification.v1"),
    ).toBe(false);
  });
});
