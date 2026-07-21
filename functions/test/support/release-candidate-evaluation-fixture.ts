import { createReleaseCandidateEvaluationApplication } from "../../src/platform/delivery-assurance/application/releaseCandidateEvaluationApplication";
import type {
  GateEvidence,
  ReleaseCandidateManifest,
} from "../../src/platform/delivery-assurance/public";

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
    .join(",")}}`;
}

function fingerprint(value: string): string {
  let state = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    state ^= value.charCodeAt(index);
    state = Math.imul(state, 0x01000193);
  }
  return `manifest:${(state >>> 0).toString(16).padStart(8, "0")}`;
}

export function createReleaseCandidateEvaluationFixture(fixture: {
  readonly gateEvidence: readonly GateEvidence[];
}) {
  return createReleaseCandidateEvaluationApplication({
    evidence: { collect: async () => fixture.gateEvidence.map((item) => ({ ...item })) },
    manifestHash: {
      hash: (manifest: ReleaseCandidateManifest) => fingerprint(stable(manifest)),
    },
  });
}
