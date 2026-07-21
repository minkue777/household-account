import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createHouseholdCommandRouter } from "../../src/bootstrap/commands/householdCommandRouter";
import {
  HouseholdCommandRejection,
  type HouseholdCommandHandler,
  type HouseholdCommandResult,
  withHouseholdCommandReceiptValue,
} from "../../src/bootstrap/commands/householdCommand";
import type {
  HouseholdCommandReceiptClaim,
  HouseholdCommandReceiptPort,
} from "../../src/bootstrap/commands/householdCommandPorts";

class ReceiptMemory implements HouseholdCommandReceiptPort {
  private readonly values = new Map<
    string,
    { payloadHash: string; result?: HouseholdCommandResult }
  >();

  async claim(input: {
    receiptId: string;
    payloadHash: string;
  }): Promise<HouseholdCommandReceiptClaim> {
    const existing = this.values.get(input.receiptId);
    if (existing === undefined) {
      this.values.set(input.receiptId, { payloadHash: input.payloadHash });
      return { kind: "claimed" };
    }
    if (existing.payloadHash !== input.payloadHash) {
      return { kind: "payload-mismatch" };
    }
    return existing.result === undefined
      ? { kind: "in-progress" }
      : { kind: "completed", result: existing.result };
  }

  async complete(input: {
    receiptId: string;
    payloadHash: string;
    result: HouseholdCommandResult;
  }): Promise<void> {
    this.values.set(input.receiptId, {
      payloadHash: input.payloadHash,
      result: input.result,
    });
  }

  async abandon(input: {
    receiptId: string;
    payloadHash: string;
  }): Promise<void> {
    if (this.values.get(input.receiptId)?.payloadHash === input.payloadHash) {
      this.values.delete(input.receiptId);
    }
  }
}

function subject(customExecute?: HouseholdCommandHandler["execute"]) {
  let executions = 0;
  const receipts = new ReceiptMemory();
  const router = createHouseholdCommandRouter({
    handlers: new Map([
      [
        "ledger.record-manual-transaction.v1",
        {
          async execute(context) {
            executions += 1;
            if (customExecute !== undefined) return customExecute(context);
            return {
              actor: context.actor?.actingMemberId,
              payload: context.envelope.payload,
            };
          },
        },
      ],
      [
        "access.resolve-signed-in-user.v1",
        { execute: async ({ principalUid }) => ({ principalUid }) },
      ],
    ]),
    memberships: {
      async resolveActor({ principalUid, householdId }) {
        return principalUid === "uid-a" && householdId === "household-a"
          ? {
              kind: "active",
              actor: {
                principalUid,
                householdId,
                actingMemberId: "member-a",
                capabilities: [],
              },
            }
          : { kind: "forbidden" };
      },
    },
    receipts,
    hashes: {
      hash: (value) =>
        createHash("sha256").update(value, "utf8").digest("hex"),
    },
  });
  const request = {
    contractVersion: "household-command.v1",
    commandId: "command-a",
    idempotencyKey: "idempotency-a",
    householdId: "household-a",
    command: "ledger.record-manual-transaction.v1",
    payload: { merchant: "가맹점", amountInWon: 10_000 },
  };
  return { router, request, executions: () => executions };
}

describe("Household command bootstrap boundary", () => {
  it("derives the actor from Auth and Membership instead of payload identity", async () => {
    const fixture = subject();
    const result = await fixture.router.execute({
      principalUid: "uid-a",
      request: fixture.request,
      requestedAt: "2026-07-21T09:00:00+09:00",
    });

    expect(result).toMatchObject({
      kind: "success",
      data: { actor: "member-a" },
    });
  });

  it("rejects client supplied identity fields before command execution", async () => {
    const fixture = subject();
    const result = await fixture.router.execute({
      principalUid: "uid-a",
      request: {
        ...fixture.request,
        payload: { actingMemberId: "member-b", merchant: "가맹점" },
      },
      requestedAt: "2026-07-21T09:00:00+09:00",
    });

    expect(result).toMatchObject({
      kind: "error",
      code: "FORBIDDEN_IDENTITY_FIELD",
    });
    expect(fixture.executions()).toBe(0);
  });

  it("allows householdId omission only for the tenantless onboarding allowlist", async () => {
    const fixture = subject();
    const tenantless = await fixture.router.execute({
      principalUid: "uid-a",
      request: {
        contractVersion: "household-command.v1",
        commandId: "resolve-a",
        idempotencyKey: "resolve-a",
        command: "access.resolve-signed-in-user.v1",
        payload: {},
      },
      requestedAt: "2026-07-21T09:00:00+09:00",
    });
    const missingTenant = await fixture.router.execute({
      principalUid: "uid-a",
      request: { ...fixture.request, householdId: undefined },
      requestedAt: "2026-07-21T09:00:00+09:00",
    });

    expect(tenantless.kind).toBe("success");
    expect(missingTenant).toMatchObject({
      kind: "error",
      code: "HOUSEHOLD_ID_REQUIRED",
    });
  });

  it("replays a completed result and rejects idempotency payload mismatch", async () => {
    const fixture = subject();
    const call = (request: unknown) =>
      fixture.router.execute({
        principalUid: "uid-a",
        request,
        requestedAt: "2026-07-21T09:00:00+09:00",
      });

    const first = await call(fixture.request);
    const replay = await call(fixture.request);
    const mismatch = await call({
      ...fixture.request,
      payload: { merchant: "다른 가맹점", amountInWon: 10_000 },
    });

    expect(first.kind).toBe("success");
    expect(replay).toMatchObject({ kind: "success", replayed: true });
    expect(mismatch).toMatchObject({
      kind: "error",
      code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
    });
    expect(fixture.executions()).toBe(1);
  });

  it("retryable rejection은 receipt를 버려 같은 idempotency key로 재시도할 수 있다", async () => {
    let attempt = 0;
    const fixture = subject(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new HouseholdCommandRejection("TEMPORARY_UNAVAILABLE", true);
      }
      return { recovered: true };
    });
    const call = () =>
      fixture.router.execute({
        principalUid: "uid-a",
        request: fixture.request,
        requestedAt: "2026-07-21T09:00:00+09:00",
      });

    await expect(call()).resolves.toMatchObject({
      kind: "error",
      retryable: true,
      details: { domainCode: "TEMPORARY_UNAVAILABLE" },
    });
    await expect(call()).resolves.toMatchObject({
      kind: "success",
      data: { recovered: true },
    });
    expect(attempt).toBe(2);
  });

  it("일회성 secret은 최초 응답에만 포함하고 receipt replay에는 저장하지 않는다", async () => {
    const fixture = subject(async () =>
      withHouseholdCommandReceiptValue(
        { invitationCode: "SECRET-CODE", expiresAt: "2026-07-21T09:05:00.000Z" },
        {
          kind: "invitation-already-issued",
          expiresAt: "2026-07-21T09:05:00.000Z",
        },
      ),
    );
    const call = () =>
      fixture.router.execute({
        principalUid: "uid-a",
        request: fixture.request,
        requestedAt: "2026-07-21T09:00:00.000Z",
      });

    await expect(call()).resolves.toMatchObject({
      kind: "success",
      data: { invitationCode: "SECRET-CODE" },
    });
    await expect(call()).resolves.toMatchObject({
      kind: "success",
      replayed: true,
      data: { kind: "invitation-already-issued" },
    });
  });
});
