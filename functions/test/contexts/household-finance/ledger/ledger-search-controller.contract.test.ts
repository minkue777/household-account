import { describe, expect, it } from "vitest";
import { createLedgerSearchControllerSubject } from "../../../support/ledger-search-controller-driver";

interface SearchRequestIdentity {
  actorSessionGeneration: string;
  householdId: string;
  transactionType: "expense" | "income";
  normalizedQuery: string;
  revision: number;
}

interface SearchResponse {
  identity: SearchRequestIdentity;
  transactionIds: readonly string[];
  nextCursor?: string;
}

interface SearchControllerView {
  state: "idle" | "loading" | "ready" | "closed";
  identity?: SearchRequestIdentity;
  transactionIds: readonly string[];
  nextCursor?: string;
}

export interface LedgerSearchControllerContractSubject {
  begin(input: Omit<SearchRequestIdentity, "normalizedQuery" | "revision"> & {
    query: string;
  }): SearchRequestIdentity;
  receive(response: SearchResponse): "committed" | "discarded";
  close(): void;
  replaceSession(input: {
    actorSessionGeneration: string;
    householdId: string;
  }): void;
  settleMutation(input: {
    commandOutcome: "success" | "failure";
  }): SearchRequestIdentity | undefined;
  view(): SearchControllerView;
}

export function createSubject(): LedgerSearchControllerContractSubject {
  return createLedgerSearchControllerSubject();
}

describe("Ledger 검색 화면 최신 요청 계약", () => {
  it("[T-SEA-002][SEA-003] 느린 검색 A 뒤 시작한 검색 B의 응답만 화면과 cursor에 반영한다", () => {
    const subject = createSubject();
    const requestA = subject.begin({
      actorSessionGeneration: "session-1",
      householdId: "house-1",
      transactionType: "expense",
      query: "삼성",
    });
    const requestB = subject.begin({
      actorSessionGeneration: "session-1",
      householdId: "house-1",
      transactionType: "expense",
      query: "국민",
    });

    expect(
      subject.receive({
        identity: requestB,
        transactionIds: ["kb-1"],
        nextCursor: "cursor-b",
      }),
    ).toBe("committed");
    expect(
      subject.receive({
        identity: requestA,
        transactionIds: ["samsung-1"],
        nextCursor: "cursor-a",
      }),
    ).toBe("discarded");
    expect(subject.view()).toMatchObject({
      state: "ready",
      identity: requestB,
      transactionIds: ["kb-1"],
      nextCursor: "cursor-b",
    });
  });

  it("[T-SEA-002][SEA-003] modal을 닫은 뒤 도착한 응답은 결과와 cursor를 다시 만들지 않는다", () => {
    const subject = createSubject();
    const request = subject.begin({
      actorSessionGeneration: "session-1",
      householdId: "house-1",
      transactionType: "expense",
      query: "국민(2972)",
    });

    subject.close();
    const outcome = subject.receive({
      identity: request,
      transactionIds: ["late"],
      nextCursor: "late-cursor",
    });

    expect(outcome).toBe("discarded");
    expect(subject.view()).toEqual({
      state: "closed",
      transactionIds: [],
    });
  });

  it("[T-SEA-002][SEA-003] logout·가구 전환 이전 session 응답을 다음 가구 화면에 반영하지 않는다", () => {
    const subject = createSubject();
    const oldRequest = subject.begin({
      actorSessionGeneration: "session-1",
      householdId: "house-1",
      transactionType: "expense",
      query: "카드",
    });

    subject.replaceSession({
      actorSessionGeneration: "session-2",
      householdId: "house-2",
    });
    const outcome = subject.receive({
      identity: oldRequest,
      transactionIds: ["house-1-secret"],
      nextCursor: "house-1-cursor",
    });

    expect(outcome).toBe("discarded");
    expect(subject.view()).toMatchObject({
      transactionIds: [],
    });
    expect(subject.view()).not.toHaveProperty("nextCursor");
  });

  it("[T-SEA-002][SEA-003] 검색 결과 mutation 성공 뒤에만 revision을 올려 재조회하고 이전 응답을 폐기한다", () => {
    const subject = createSubject();
    const initialRequest = subject.begin({
      actorSessionGeneration: "session-1",
      householdId: "house-1",
      transactionType: "expense",
      query: "국민카드",
    });
    subject.receive({
      identity: initialRequest,
      transactionIds: ["before-mutation"],
      nextCursor: "before-cursor",
    });

    expect(subject.settleMutation({ commandOutcome: "failure" })).toBeUndefined();
    expect(subject.view()).toMatchObject({
      state: "ready",
      identity: initialRequest,
      transactionIds: ["before-mutation"],
      nextCursor: "before-cursor",
    });

    const requery = subject.settleMutation({ commandOutcome: "success" });
    expect(requery).toEqual({ ...initialRequest, revision: initialRequest.revision + 1 });
    expect(subject.view()).toMatchObject({
      state: "loading",
      identity: requery,
      transactionIds: [],
    });
    expect(subject.view()).not.toHaveProperty("nextCursor");
    expect(
      subject.receive({
        identity: initialRequest,
        transactionIds: ["stale-after-mutation"],
        nextCursor: "stale-cursor",
      }),
    ).toBe("discarded");
    expect(
      subject.receive({
        identity: requery as SearchRequestIdentity,
        transactionIds: ["after-mutation"],
      }),
    ).toBe("committed");
    expect(subject.view()).toMatchObject({
      state: "ready",
      transactionIds: ["after-mutation"],
    });
  });
});
