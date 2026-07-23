import { describe, expect, it } from "vitest";

import { createHouseholdQueryRouter } from "../../src/bootstrap/queries/householdQueryRouter";
import { HouseholdQueryRejection } from "../../src/bootstrap/queries/householdQuery";
import {
  startInteractiveLatencyInvocation,
  type InteractiveLatencyLogEntry,
} from "../../src/observability/interactiveLatency";

function fixture(handler: { execute(context: never): Promise<unknown> } = {
  async execute() {
    return { transactionId: "transaction-1", aggregateVersion: 3 };
  },
}) {
  const router = createHouseholdQueryRouter({
    handlers: new Map([["ledger.get-transaction.v1", handler]]),
    memberships: {
      async resolveActor({ principalUid, householdId }) {
        return principalUid === "uid-a" && householdId === "house-a"
          ? {
              kind: "active" as const,
              actor: {
                principalUid,
                householdId,
                actingMemberId: "member-a",
                capabilities: [],
              },
            }
          : { kind: "forbidden" as const };
      },
    },
  });
  const request = {
    contractVersion: "household-query.v1",
    queryId: "query-1",
    householdId: "house-a",
    query: "ledger.get-transaction.v1",
    payload: { transactionId: "transaction-1" },
  };
  return { router, request };
}

describe("household query bootstrap boundary", () => {
  it("Auth와 Membership으로 tenant를 검증한 뒤 query handler를 호출한다", async () => {
    const subject = fixture();

    await expect(
      subject.router.execute({ principalUid: "uid-a", request: subject.request }),
    ).resolves.toEqual({
      kind: "success",
      queryId: "query-1",
      data: { transactionId: "transaction-1", aggregateVersion: 3 },
    });
  });

  it("payload와 envelope의 actor 위조 필드를 거부한다", async () => {
    const subject = fixture();

    await expect(
      subject.router.execute({
        principalUid: "uid-a",
        request: {
          ...subject.request,
          payload: { transactionId: "transaction-1", actingMemberId: "forged" },
        },
      }),
    ).resolves.toMatchObject({ kind: "error", code: "FORBIDDEN_IDENTITY_FIELD" });
    await expect(
      subject.router.execute({
        principalUid: "uid-a",
        request: { ...subject.request, actingMemberId: "forged" },
      }),
    ).resolves.toMatchObject({ kind: "error", code: "INVALID_CONTRACT" });
  });

  it("다른 household membership이면 데이터 존재 여부를 노출하지 않는다", async () => {
    const subject = fixture();

    await expect(
      subject.router.execute({
        principalUid: "uid-a",
        request: { ...subject.request, householdId: "house-b" },
      }),
    ).resolves.toMatchObject({ kind: "error", code: "FORBIDDEN" });
  });

  it("검증된 시스템 관리자는 가구원이 아니어도 조회 허용 목록만 실행한다", async () => {
    const subject = fixture();
    const handler = subject.router.execute({
      principalUid: "uid-admin",
      administrator: {
        principalRef: "uid-admin",
        capabilities: ["admin.household-data.read"],
      },
      request: { ...subject.request, householdId: "house-b" },
    });

    await expect(handler).resolves.toEqual({
      kind: "success",
      queryId: "query-1",
      data: { transactionId: "transaction-1", aggregateVersion: 3 },
    });
  });

  it("domain rejection을 transport detail 없이 전달한다", async () => {
    const subject = fixture({
      async execute() {
        throw new HouseholdQueryRejection("NOT_FOUND");
      },
    });

    await expect(
      subject.router.execute({ principalUid: "uid-a", request: subject.request }),
    ).resolves.toEqual({
      kind: "error",
      queryId: "query-1",
      code: "NOT_FOUND",
      retryable: false,
    });
  });

  it("membership과 handler 단계를 query 종류와 같은 correlation으로 계측한다", async () => {
    const subject = fixture();
    const entries: InteractiveLatencyLogEntry[] = [];
    const latency = startInteractiveLatencyInvocation(
      "executeHouseholdQuery",
      { sink: { write: (entry) => entries.push(entry) } },
    );

    const result = await latency.run(() =>
      subject.router.execute({
        principalUid: "uid-a",
        request: subject.request,
      }),
    );
    latency.complete(result.kind === "success" ? "succeeded" : "rejected");

    expect(entries.map((entry) => entry.stage)).toEqual([
      "actor-membership",
      "handler",
      "total",
    ]);
    expect(
      new Set(entries.map((entry) => entry.operation)),
    ).toEqual(new Set(["ledger.get-transaction.v1"]));
    expect(
      new Set(entries.map((entry) => entry.correlationId)),
    ).toEqual(new Set([latency.correlationId]));
  });
});
