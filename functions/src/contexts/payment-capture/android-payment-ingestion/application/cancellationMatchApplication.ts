import type { CancellationMatchInputPort } from "./ports/in/cancellationMatchInputPort";
import { decideCancellationMatchPolicy } from "../domain/policies/cancellationMatch";
import { buildCancellationSearchWindowPolicy } from "../domain/policies/cancellationSearchWindow";

export function createCancellationMatchApplication(): CancellationMatchInputPort {
  return {
    buildSearchWindow: buildCancellationSearchWindowPolicy,
    decide: decideCancellationMatchPolicy,
  };
}
