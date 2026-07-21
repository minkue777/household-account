import type { PwaSessionScopePort } from "../reference/pwa/application/ports/out/pwaSessionScopePort";
import type {
  PwaSessionCleanupState,
  PwaSessionScopeSnapshot,
} from "../reference/pwa/domain/model/pwaSessionScope";

export class InMemoryPwaSessionScope implements PwaSessionScopePort {
  private generation: string | undefined;
  private cleanupState: PwaSessionCleanupState = "clean";

  constructor(initialGeneration?: string) {
    this.generation = initialGeneration;
  }

  snapshot(): PwaSessionScopeSnapshot {
    return { generation: this.generation, cleanupState: this.cleanupState };
  }

  open(generation: string): void {
    this.generation = generation;
    this.cleanupState = "clean";
  }

  clear(): void {
    this.generation = undefined;
    this.cleanupState = "clean";
  }

  beginCleanup(): void {
    this.generation = undefined;
    this.cleanupState = "required";
  }

  isolate(): void {
    this.generation = undefined;
    this.cleanupState = "isolated";
  }
}
