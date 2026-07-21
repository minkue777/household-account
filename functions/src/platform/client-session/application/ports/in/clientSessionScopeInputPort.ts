import type {
  ClientSessionScope,
  ClientSessionState,
} from "../../../domain/clientSessionScope";

export type ProtectedClientOperation =
  | "protected-query"
  | "initialize-default-categories"
  | "register-endpoint";

export interface ClientSessionScopeInputPort {
  establish(
    scope: Omit<ClientSessionScope, "sessionGeneration">,
    untrustedNativeMirror?: Partial<
      Omit<ClientSessionScope, "sessionGeneration">
    >,
  ): ClientSessionScope;
  attemptBeforeMembership(
    operation: ProtectedClientOperation,
  ): { kind: "blocked"; code: "AUTHENTICATED_MEMBERSHIP_REQUIRED" };
  beginQuery(key: string): { key: string; scope: ClientSessionScope };
  receiveQuery(input: {
    token: { key: string; scope: ClientSessionScope };
    recordIds: readonly string[];
  }): "committed" | "discarded";
  subscribe(key: string): {
    subscriptionId: string;
    scope: ClientSessionScope;
  };
  receiveSubscription(input: {
    subscriptionId: string;
    scope: ClientSessionScope;
    recordIds: readonly string[];
  }): "committed" | "discarded";
  requestWrite(input: {
    scope: ClientSessionScope;
    recordId: string;
  }): "accepted" | "discarded";
  logout(): void;
  state(): ClientSessionState;
}

export type { ClientSessionScope, ClientSessionState };
