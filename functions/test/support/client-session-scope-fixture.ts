import { createClientSessionScopeApplication } from "../../src/platform/client-session/application/clientSessionScopeApplication";
import type { ClientSessionStatePort } from "../../src/platform/client-session/application/ports/out/clientSessionStatePort";
import { emptyClientSessionState } from "../../src/platform/client-session/domain/clientSessionScope";
import type {
  ClientSessionScopeInputPort,
  ClientSessionState,
} from "../../src/platform/client-session/public";

class FixtureClientSessionState implements ClientSessionStatePort {
  private current: ClientSessionState = emptyClientSessionState();
  private generation = 0;

  read(): ClientSessionState {
    return structuredClone(this.current);
  }

  replace(state: ClientSessionState): void {
    this.current = structuredClone(state);
  }

  nextGeneration(): number {
    this.generation += 1;
    return this.generation;
  }
}

export function createClientSessionScopeFixture(): ClientSessionScopeInputPort {
  return createClientSessionScopeApplication({
    state: new FixtureClientSessionState(),
  });
}
