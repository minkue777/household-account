import type { HardenedIngressInputPort } from "./ports/in/hardenedIngressInputPort";
import type {
  RefreshIngressAppCheckPort,
  RefreshIngressAuthPort,
  RefreshIngressQuotaPort,
  RefreshRunIdentityPort,
  RefreshRunRepositoryPort,
  RefreshTargetSourcePort,
} from "./ports/out/hardenedIngressPorts";

export function createHardenedIngressApplication(dependencies: {
  readonly allowedOrigins: readonly string[];
  readonly maxBodyBytes: number;
  readonly maxFieldChars: number;
  readonly maxPageSize: number;
  readonly auth: RefreshIngressAuthPort;
  readonly appCheck: RefreshIngressAppCheckPort;
  readonly quota: RefreshIngressQuotaPort;
  readonly targets: RefreshTargetSourcePort;
  readonly runs: RefreshRunRepositoryPort;
  readonly identities: RefreshRunIdentityPort;
}): HardenedIngressInputPort {
  return {
    async invoke(request) {
      if (request.method === "OPTIONS") return { kind: "no-content", status: 204 };
      if (request.method !== "POST") {
        return { kind: "rejected", code: "METHOD_NOT_ALLOWED" };
      }
      if (request.contentType !== "application/json") {
        return { kind: "rejected", code: "CONTENT_TYPE_NOT_SUPPORTED" };
      }
      if (request.contractVersion !== "1") {
        return { kind: "rejected", code: "CONTRACT_VERSION_NOT_SUPPORTED" };
      }
      if (request.bodyBytes > dependencies.maxBodyBytes) {
        return { kind: "rejected", code: "BODY_TOO_LARGE" };
      }
      if (request.largestFieldChars > dependencies.maxFieldChars) {
        return { kind: "rejected", code: "FIELD_TOO_LARGE" };
      }
      if (!dependencies.allowedOrigins.includes(request.origin)) {
        return { kind: "rejected", code: "CORS_ORIGIN_REJECTED" };
      }

      const actor = await dependencies.auth.verify(request.authToken);
      if (actor === undefined) return { kind: "rejected", code: "AUTH_REQUIRED" };
      if (!(await dependencies.appCheck.verify(request.appCheckToken))) {
        return { kind: "rejected", code: "APP_CHECK_REJECTED" };
      }
      if (actor.householdId !== request.householdId) {
        return { kind: "rejected", code: "HOUSEHOLD_SCOPE_MISMATCH" };
      }
      if (!(await dependencies.quota.rateAvailable(actor.actorId, request.requestedAt))) {
        return { kind: "rejected", code: "RATE_LIMITED" };
      }
      if (!(await dependencies.quota.costAvailable(actor.actorId, actor.householdId))) {
        return { kind: "rejected", code: "COST_QUOTA_EXHAUSTED" };
      }

      const reusable = await dependencies.runs.findReusable({
        actorId: actor.actorId,
        householdId: actor.householdId,
        scope: "market.refresh",
        requestedAt: request.requestedAt,
        windowSeconds: 30,
      });
      if (reusable !== undefined) return { kind: "accepted", run: reusable };

      const targetIds = await dependencies.targets.activeTargetIds(actor.householdId);
      const pageSizes: number[] = [];
      const processedTargetIds: string[] = [];
      for (let offset = 0; offset < targetIds.length; offset += dependencies.maxPageSize) {
        const page = targetIds.slice(offset, offset + dependencies.maxPageSize);
        pageSizes.push(page.length);
        processedTargetIds.push(...page);
      }
      const run = {
        runId: dependencies.identities.next(),
        householdId: actor.householdId,
        status: "COMPLETE" as const,
        targetTotal: targetIds.length,
        processedTargetIds,
        pageSizes,
        createdAt: request.requestedAt,
      };
      await dependencies.runs.save({ actorId: actor.actorId, scope: "market.refresh", run });
      return { kind: "accepted", run };
    },
  };
}
