import { createDeploymentProvenanceApplication } from "../../src/platform/delivery-assurance/application/deploymentProvenanceApplication";
import type {
  ApprovedRelease,
  PublicDeploymentRecord,
} from "../../src/platform/delivery-assurance/public";

function stable(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
    .join(",")}}`;
}

export function createDeploymentProvenanceFixture(fixture: {
  readonly now: string;
  readonly approvedReleases: readonly ApprovedRelease[];
  readonly verifiedMonitoringChannels: readonly string[];
  readonly secretMaterial: readonly string[];
}) {
  const stored = new Map<string, { fingerprint: string; record: PublicDeploymentRecord }>();
  let queue = Promise.resolve();
  let sequence = 0;
  return createDeploymentProvenanceApplication({
    releases: {
      get: async (releaseId) => fixture.approvedReleases.find((item) => item.releaseId === releaseId),
    },
    channels: {
      isVerified: async (resource) => fixture.verifiedMonitoringChannels.includes(resource),
    },
    records: {
      async get(releaseId) {
        return stored.get(releaseId)?.record;
      },
      async record(input) {
        let release!: () => void;
        const previous = queue;
        queue = new Promise<void>((done) => {
          release = done;
        });
        await previous;
        try {
          const existing = stored.get(input.releaseId);
          if (existing !== undefined) {
            return existing.fingerprint === input.fingerprint
              ? { kind: "replayed" as const, record: existing.record }
              : { kind: "conflict" as const };
          }
          stored.set(input.releaseId, {
            fingerprint: input.fingerprint,
            record: input.candidate,
          });
          return { kind: "recorded" as const, record: input.candidate };
        } finally {
          release();
        }
      },
    },
    identity: {
      deploymentId: (releaseId) => `deployment:${releaseId}:${++sequence}`,
      fingerprint: stable,
    },
    clock: { now: () => fixture.now },
  });
}
