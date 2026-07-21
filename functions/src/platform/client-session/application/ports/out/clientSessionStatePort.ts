import type { ClientSessionState } from "../../../domain/clientSessionScope";

export interface ClientSessionStatePort {
  read(): ClientSessionState;
  replace(state: ClientSessionState): void;
  nextGeneration(): number;
}
