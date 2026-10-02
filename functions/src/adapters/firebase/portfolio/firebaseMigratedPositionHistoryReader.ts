import type * as firestore from "firebase-admin/firestore";
import type { DividendPositionHistoryView } from "../../../contexts/portfolio/holdings/public";

/** Read-only evidence from completed migration plans; never invents past quantity from a current Position. */
export async function readMigratedPositionHistory(
  database: firestore.Firestore,
  input: { readonly householdId: string; readonly assetIds: ReadonlySet<string>; readonly instrumentCode: string },
): Promise<readonly DividendPositionHistoryView[]> {
  if (input.assetIds.size === 0) return [];
  const plans = await database.collection("operationsMigrationPlans")
    .where("scope.householdId", "==", input.householdId).get();
  const observations: DividendPositionHistoryView[] = [];
  for (const plan of plans.docs) {
    const data = plan.data();
    if (data.scope?.householdId !== input.householdId || data.status !== "completed" ||
        !Number.isSafeInteger(data.candidateCount) || data.candidateCount < 1 ||
        data.nextIndex !== data.candidateCount || typeof data.createdAt !== "string" ||
        !Number.isFinite(Date.parse(data.createdAt))) continue;
    const observedAt = new Date(data.createdAt).toISOString();
    const snapshotDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(observedAt));
    const candidates = await plan.ref.collection("candidates").where("logicalCollection", "==", "position").get();
    for (const candidate of candidates.docs) {
      const value = candidate.data();
      const position = value.targetData;
      if (value.action !== "create" || value.logicalCollection !== "position" ||
          typeof position !== "object" || position === null ||
          position.householdId !== input.householdId || !input.assetIds.has(position.assetId) ||
          typeof position.positionId !== "string" || position.positionId.length === 0 ||
          position.market !== "KRX" || position.instrumentCode !== input.instrumentCode ||
          !["active", "deleted"].includes(position.lifecycleState) ||
          typeof position.quantity !== "number" || !Number.isFinite(position.quantity) || position.quantity < 0 ||
          !Number.isSafeInteger(position.aggregateVersion) || position.aggregateVersion < 1 ||
          value.targetPath !== `households/${input.householdId}/assets/${position.assetId}/positions/${position.positionId}`) continue;
      observations.push({ householdId: input.householdId, assetId: position.assetId,
        positionId: position.positionId, instrumentCode: input.instrumentCode,
        snapshotDate, observedAt, quantity: position.lifecycleState === "deleted" ? 0 : position.quantity,
        sourceVersion: `migration:${plan.id}:${candidate.id}:v${position.aggregateVersion}`,
      });
    }
  }
  return observations;
}
