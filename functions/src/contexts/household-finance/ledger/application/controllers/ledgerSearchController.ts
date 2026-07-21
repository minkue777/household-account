export interface SearchRequestIdentity {
  actorSessionGeneration: string;
  householdId: string;
  transactionType: "expense" | "income";
  normalizedQuery: string;
  revision: number;
}

export interface SearchResponse {
  identity: SearchRequestIdentity;
  transactionIds: readonly string[];
  nextCursor?: string;
}

export interface SearchControllerView {
  state: "idle" | "loading" | "ready" | "closed";
  identity?: SearchRequestIdentity;
  transactionIds: readonly string[];
  nextCursor?: string;
}

export interface LedgerSearchController {
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

function normalizeQuery(query: string): string {
  return query.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

function sameIdentity(
  left: SearchRequestIdentity | undefined,
  right: SearchRequestIdentity,
): boolean {
  return (
    left?.actorSessionGeneration === right.actorSessionGeneration &&
    left.householdId === right.householdId &&
    left.transactionType === right.transactionType &&
    left.normalizedQuery === right.normalizedQuery &&
    left.revision === right.revision
  );
}

function copyIdentity(identity: SearchRequestIdentity): SearchRequestIdentity {
  return { ...identity };
}

export function createLedgerSearchController(): LedgerSearchController {
  let revision = 0;
  let state: SearchControllerView["state"] = "idle";
  let identity: SearchRequestIdentity | undefined;
  let transactionIds: string[] = [];
  let nextCursor: string | undefined;

  return {
    begin: (request) => {
      revision += 1;
      identity = {
        actorSessionGeneration: request.actorSessionGeneration,
        householdId: request.householdId,
        transactionType: request.transactionType,
        normalizedQuery: normalizeQuery(request.query),
        revision,
      };
      state = "loading";
      transactionIds = [];
      nextCursor = undefined;
      return copyIdentity(identity);
    },
    receive: (response) => {
      if (state !== "loading" || !sameIdentity(identity, response.identity)) {
        return "discarded";
      }
      state = "ready";
      transactionIds = [...response.transactionIds];
      nextCursor = response.nextCursor;
      return "committed";
    },
    close: () => {
      state = "closed";
      identity = undefined;
      transactionIds = [];
      nextCursor = undefined;
    },
    replaceSession: () => {
      revision += 1;
      state = "idle";
      identity = undefined;
      transactionIds = [];
      nextCursor = undefined;
    },
    settleMutation: ({ commandOutcome }) => {
      if (commandOutcome !== "success" || identity === undefined) {
        return undefined;
      }
      revision += 1;
      identity = { ...identity, revision };
      state = "loading";
      transactionIds = [];
      nextCursor = undefined;
      return copyIdentity(identity);
    },
    view: () => ({
      state,
      ...(identity === undefined ? {} : { identity: copyIdentity(identity) }),
      transactionIds: [...transactionIds],
      ...(nextCursor === undefined ? {} : { nextCursor }),
    }),
  };
}
