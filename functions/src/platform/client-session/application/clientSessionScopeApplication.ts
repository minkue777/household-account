import {
  emptyClientSessionState,
  sameSessionScope,
} from "../domain/clientSessionScope";
import type { ClientSessionScopeInputPort } from "./ports/in/clientSessionScopeInputPort";
import type { ClientSessionStatePort } from "./ports/out/clientSessionStatePort";

function requireScope(statePort: ClientSessionStatePort) {
  const scope = statePort.read().scope;
  if (scope === undefined) throw new Error("인증된 Membership session이 필요합니다.");
  return scope;
}

export function createClientSessionScopeApplication(dependencies: {
  readonly state: ClientSessionStatePort;
}): ClientSessionScopeInputPort {
  return {
    establish(identity) {
      const scope = {
        ...identity,
        sessionGeneration: dependencies.state.nextGeneration(),
      };
      dependencies.state.replace({ ...emptyClientSessionState(), scope });
      return scope;
    },
    attemptBeforeMembership() {
      return {
        kind: "blocked",
        code: "AUTHENTICATED_MEMBERSHIP_REQUIRED",
      };
    },
    beginQuery(key) {
      const state = dependencies.state.read();
      const scope = requireScope(dependencies.state);
      dependencies.state.replace({
        ...state,
        cachedKeys: state.cachedKeys.includes(key)
          ? state.cachedKeys
          : [...state.cachedKeys, key],
      });
      return { key, scope };
    },
    receiveQuery(input) {
      const state = dependencies.state.read();
      if (!sameSessionScope(state.scope, input.token.scope)) return "discarded";
      dependencies.state.replace({
        ...state,
        renderedRecordIds: [...input.recordIds],
      });
      return "committed";
    },
    subscribe(key) {
      const state = dependencies.state.read();
      const scope = requireScope(dependencies.state);
      const subscriptionId = `subscription:${scope.sessionGeneration}:${key}`;
      dependencies.state.replace({
        ...state,
        activeSubscriptions: state.activeSubscriptions.includes(subscriptionId)
          ? state.activeSubscriptions
          : [...state.activeSubscriptions, subscriptionId],
      });
      return { subscriptionId, scope };
    },
    receiveSubscription(input) {
      const state = dependencies.state.read();
      if (
        !sameSessionScope(state.scope, input.scope) ||
        !state.activeSubscriptions.includes(input.subscriptionId)
      ) {
        return "discarded";
      }
      dependencies.state.replace({
        ...state,
        renderedRecordIds: [...input.recordIds],
      });
      return "committed";
    },
    requestWrite(input) {
      const state = dependencies.state.read();
      if (!sameSessionScope(state.scope, input.scope)) return "discarded";
      dependencies.state.replace({
        ...state,
        writes: [
          ...state.writes,
          { householdId: input.scope.householdId, recordId: input.recordId },
        ],
      });
      return "accepted";
    },
    logout() {
      dependencies.state.replace(emptyClientSessionState());
    },
    state() {
      return structuredClone(dependencies.state.read());
    },
  };
}
