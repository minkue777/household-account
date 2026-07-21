import { describe, expect, it } from "vitest";

import { toHouseholdCommandWireResponse } from "../../src/bootstrap/firebaseHouseholdCommand";

describe("Household command callable wire response", () => {
  it("maps success and replay to the shared response contract", () => {
    const request = { commandId: "command-1" };
    expect(
      toHouseholdCommandWireResponse(request, {
        kind: "success",
        commandId: "command-1",
        data: { transactionId: "transaction-1" },
      }),
    ).toEqual({
      contractVersion: "household-command-response.v1",
      commandId: "command-1",
      result: {
        kind: "succeeded",
        value: { transactionId: "transaction-1" },
      },
    });
    expect(
      toHouseholdCommandWireResponse(request, {
        kind: "success",
        commandId: "command-1",
        data: { transactionId: "transaction-1" },
        replayed: true,
      }).result.kind,
    ).toBe("already-processed");
  });

  it("maps rejected results without exposing internal details", () => {
    expect(
      toHouseholdCommandWireResponse(
        { commandId: "command-1" },
        {
          kind: "error",
          commandId: "command-1",
          code: "COMMAND_FAILED",
          retryable: false,
          details: { domainCode: "VERSION_MISMATCH", secret: "not-public" },
        },
      ),
    ).toEqual({
      contractVersion: "household-command-response.v1",
      commandId: "command-1",
      result: {
        kind: "rejected",
        error: { code: "VERSION_MISMATCH", retryable: false },
      },
    });
  });
});
