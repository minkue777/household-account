import { describe, expect, it, vi } from "vitest";

import type { ShortcutCredentialLifecycleInputPort } from "../../src/contexts/payment-capture/shortcut-ingestion/application/ports/in/shortcutCredentialLifecycleInputPort";
import {
  householdCommandReceiptValue,
  type HouseholdCommandExecutionContext,
} from "../../src/bootstrap/commands/householdCommand";
import { createShortcutCredentialHouseholdCommandHandlers } from "../../src/bootstrap/commands/shortcutCredentialHouseholdCommandHandlers";
import { createShortcutCredentialHouseholdQueryHandlers } from "../../src/bootstrap/queries/shortcutCredentialHouseholdQueryHandlers";

function context(command: string, payload: Record<string, unknown> = {}): HouseholdCommandExecutionContext {
  return {
    envelope: {
      contractVersion: "household-command.v1",
      commandId: "command-1",
      idempotencyKey: "idempotency-1",
      householdId: "household-a",
      command,
      payload,
    },
    principalUid: "uid-a",
    actor: {
      principalUid: "uid-a",
      householdId: "household-a",
      actingMemberId: "member-a",
      capabilities: [],
    },
    requestedAt: "2026-07-21T09:00:00+09:00",
  };
}

function lifecycleFixture(): ShortcutCredentialLifecycleInputPort {
  return {
    issue: vi.fn(async () => ({
      kind: "issued" as const,
      credentialId: "credential-a",
      credentialVersion: 1,
      rawCredential: "one-time-secret",
      installUrl: "https://www.icloud.com/shortcuts/template-id",
      issuedAt: "2026-07-21T09:00:00+09:00",
    })),
    reissue: vi.fn(async () => ({
      kind: "alreadyIssued" as const,
      credentialId: "credential-b",
      credentialVersion: 2,
    })),
    authorize: vi.fn(async () => ({
      kind: "unauthenticated" as const,
      httpStatus: 401 as const,
      code: "AUTH_REQUIRED" as const,
    })),
    getStatus: vi.fn(async () => ({ kind: "notFound" as const })),
    revoke: vi.fn(async () => ({ kind: "notFound" as const })),
  };
}

describe("Shortcut credential Household command/query handlers", () => {
  it("최초 발급 원문은 wire 응답에만 두고 command receipt에는 metadata만 남긴다", async () => {
    const lifecycle = lifecycleFixture();
    const handler = createShortcutCredentialHouseholdCommandHandlers(lifecycle).get(
      "shortcut.issue-credential.v1",
    );
    if (handler === undefined) throw new Error("issue handler missing");

    const response = await handler.execute(
      context("shortcut.issue-credential.v1"),
    );

    expect(response).toMatchObject({
      kind: "issued",
      rawCredential: "one-time-secret",
      credentialId: "credential-a",
    });
    expect(householdCommandReceiptValue(response)).toEqual({
      kind: "alreadyIssued",
      credentialId: "credential-a",
      credentialVersion: 1,
    });
    expect(lifecycle.issue).toHaveBeenCalledWith({
      session: {
        principalUid: "uid-a",
        householdId: "household-a",
        memberId: "member-a",
        membershipState: "active",
        householdState: "active",
      },
      requestedAt: "2026-07-21T09:00:00+09:00",
      idempotencyKey: "idempotency-1",
      issuanceMode: "if-absent",
    });
  });

  it("상태 조회도 payload 신원이 아니라 검증된 Actor로 session을 구성한다", async () => {
    const lifecycle = lifecycleFixture();
    const handler = createShortcutCredentialHouseholdQueryHandlers(lifecycle).get(
      "shortcut.get-credential-status.v1",
    );
    if (handler === undefined) throw new Error("status handler missing");

    await expect(
      handler.execute({
        envelope: {
          contractVersion: "household-query.v1",
          queryId: "query-1",
          householdId: "household-a",
          query: "shortcut.get-credential-status.v1",
          payload: {},
        },
        principalUid: "uid-a",
        actor: context("unused").actor!,
      }),
    ).resolves.toEqual({ kind: "notFound" });
    expect(lifecycle.getStatus).toHaveBeenCalledWith({
      session: {
        principalUid: "uid-a",
        householdId: "household-a",
        memberId: "member-a",
        membershipState: "active",
        householdState: "active",
      },
    });
  });
});
