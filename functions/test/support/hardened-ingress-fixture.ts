import { createHardenedIngressApplication } from "../../src/platform/external-operations/application/hardenedIngressApplication";
import type { RefreshRunView } from "../../src/platform/external-operations/public";

export function createHardenedIngressFixture(seed: {
  readonly validAuthToken: string;
  readonly validAppCheckToken: string;
  readonly actorHouseholdId: string;
  readonly allowedOrigins: readonly string[];
  readonly serverDerivedTargetIds: readonly string[];
  readonly limits: {
    readonly maxBodyBytes: number;
    readonly maxFieldChars: number;
    readonly maxPageSize: number;
  };
  readonly quotaAvailable?: boolean;
  readonly rateLimitAvailable?: boolean;
}) {
  const runs: { actorId: string; scope: "market.refresh"; run: RefreshRunView }[] = [];
  let sequence = 0;
  const application = createHardenedIngressApplication({
    allowedOrigins: seed.allowedOrigins,
    ...seed.limits,
    auth: {
      async verify(token) {
        return token === seed.validAuthToken
          ? { actorId: "actor-1", householdId: seed.actorHouseholdId }
          : undefined;
      },
    },
    appCheck: { verify: async (token) => token === seed.validAppCheckToken },
    quota: {
      rateAvailable: async () => seed.rateLimitAvailable !== false,
      costAvailable: async () => seed.quotaAvailable !== false,
    },
    targets: { activeTargetIds: async () => [...seed.serverDerivedTargetIds] },
    runs: {
      async findReusable(input) {
        return runs.find(({ actorId, scope, run }) =>
          actorId === input.actorId &&
          scope === input.scope &&
          run.householdId === input.householdId &&
          Date.parse(input.requestedAt) - Date.parse(run.createdAt) < input.windowSeconds * 1_000,
        )?.run;
      },
      async save(entry) {
        runs.push(entry);
      },
    },
    identities: { next: () => `refresh-run-${++sequence}` },
  });
  return {
    ...application,
    listRefreshRuns: () => runs.map(({ run }) => run),
  };
}
