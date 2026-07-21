import type { PwaSessionScopeSnapshot } from "../../../domain/model/pwaSessionScope";

export interface PwaSessionScopePort {
  snapshot(): PwaSessionScopeSnapshot;
  open(generation: string): void;
  clear(): void;
  beginCleanup(): void;
  isolate(): void;
}
