import {
  applyDividendProjectionChange,
  rebuildDividendProjection,
} from "../domain/policies/dividendProjectionPolicy";
import type { DividendProjectionWriter } from "./ports/in/dividendProjectionWriter";
import type { DividendProjectionStore } from "./ports/out/dividendProjectionStore";

export function createDividendProjectionWriterApplication(
  store: DividendProjectionStore,
): DividendProjectionWriter {
  return {
    async handle(change) {
      const current = store.current();
      const decision = applyDividendProjectionChange(current, change);
      if (decision.kind === "already-processed") {
        return { kind: "already-processed", value: current };
      }
      if (decision.kind === "rebuild-required") {
        const value = { ...current, freshness: "rebuilding" as const };
        store.replace(value);
        return { kind: "rebuild-required", value };
      }
      store.replace(decision.value);
      return { kind: "success", value: decision.value };
    },
    async attemptDirectOverwrite(_input) {
      return {
        kind: "forbidden",
        code: "DIVIDEND_PROJECTION_WRITE_FORBIDDEN",
      };
    },
    async rebuild(canonicalEvents) {
      const value = rebuildDividendProjection(store.current(), canonicalEvents);
      store.replace(value);
      return { kind: "success", value };
    },
    currentProjection: () => store.current(),
  };
}
