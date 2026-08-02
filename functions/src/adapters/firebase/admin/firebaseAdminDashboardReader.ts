import type * as firestore from "firebase-admin/firestore";

import type {
  AdminDashboardDailyAccess,
  AdminDashboardBillingCost,
  AdminDashboardHealth,
  AdminDashboardHouseholdActivity,
  AdminDashboardMemberActivity,
  AdminDashboardProviderHealth,
  AdminDashboardScheduledJob,
  AdminFunctionLatencyReaderPort,
  AdminOperationsDashboard,
} from "../../../platform/admin-operations/application/adminOperationsDashboard";
import { BILLING_COST_SNAPSHOT_PATH } from "./firebaseBillingCostSummaryStore";
import { loadScheduledJobDefinitions } from "../../../operations/scheduling/scheduledJobDefinitions";
import { seoulCalendarDate } from "../../../platform/usage-observability/public";

const OPERATIONS_DOCUMENT = "runtime";
const VALID_JOB_STATUS = new Set([
  "EXPECTED",
  "RUNNING",
  "MISSING",
  "OVERDUE",
  "COMPLETE",
  "PARTIAL_FAILURE",
  "FAILED",
]);

function operationsCollection(
  database: firestore.Firestore,
  name: string,
): firestore.CollectionReference {
  return database.collection("operations").doc(OPERATIONS_DOCUMENT).collection(name);
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function count(value: unknown): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : 0;
}

function amount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function instant(value: unknown): string | undefined {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate(): Date }).toDate();
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }
  return undefined;
}

function countMap(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, candidate]) => {
      const parsed = count(candidate);
      return parsed > 0 ? [[key, parsed]] : [];
    }),
  );
}

function recentDates(generatedAt: string, rangeDays: number): readonly string[] {
  const today = seoulCalendarDate(generatedAt);
  const todayTimestamp = Date.parse(`${today}T00:00:00.000Z`);
  return Array.from({ length: rangeDays }, (_, index) =>
    new Date(todayTimestamp - (rangeDays - index - 1) * 24 * 60 * 60 * 1_000)
      .toISOString()
      .slice(0, 10),
  );
}

function latest(left: string | undefined, right: string | undefined): string | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function totals(value: unknown): AdminDashboardScheduledJob["totals"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const data = value as Record<string, unknown>;
  return {
    target: count(data.target),
    succeeded: count(data.succeeded),
    skipped: count(data.skipped),
    failed: count(data.failed),
  };
}

export function parseAdminDashboardBillingCost(
  value: unknown,
  generatedAt: string,
): AdminDashboardBillingCost {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { status: "unavailable" };
  }
  const data = value as Record<string, unknown>;
  const billingMonth = string(data.billingMonth);
  const currency = string(data.currency);
  const monthToDateAmount = amount(data.monthToDateAmount);
  const estimatedMonthEndAmount = amount(data.estimatedMonthEndAmount);
  const calculatedAt = instant(data.calculatedAt);
  const dataUpdatedAt = instant(data.dataUpdatedAt);
  if (
    data.schemaVersion !== 1 ||
    data.status !== "available" ||
    billingMonth === undefined ||
    !/^\d{4}-\d{2}$/u.test(billingMonth) ||
    billingMonth !== seoulCalendarDate(generatedAt).slice(0, 7) ||
    currency === undefined ||
    monthToDateAmount === undefined ||
    estimatedMonthEndAmount === undefined ||
    calculatedAt === undefined ||
    dataUpdatedAt === undefined ||
    !Array.isArray(data.serviceAmounts)
  ) {
    return { status: "unavailable" };
  }
  const serviceAmounts = data.serviceAmounts.flatMap((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return [];
    }
    const service = value as Record<string, unknown>;
    const serviceId = string(service.serviceId);
    const serviceName = string(service.serviceName);
    const serviceAmount = amount(service.amount);
    return serviceId === undefined ||
      serviceName === undefined ||
      serviceAmount === undefined
      ? []
      : [{ serviceId, serviceName, amount: serviceAmount }];
  });
  return {
    status: "available",
    billingMonth,
    currency,
    monthToDateAmount,
    estimatedMonthEndAmount,
    calculatedAt,
    dataUpdatedAt,
    serviceAmounts,
  };
}

export class FirebaseAdminDashboardReader {
  constructor(
    private readonly database: firestore.Firestore,
    private readonly runtime: {
      readonly serviceName: string;
      readonly revision: string;
      readonly region: string;
    },
    private readonly functionLatencyReader?: AdminFunctionLatencyReaderPort,
  ) {}

  async read(input: {
    readonly generatedAt: string;
    readonly rangeDays: number;
  }): Promise<AdminOperationsDashboard> {
    const definitions = loadScheduledJobDefinitions();
    const [
      householdSnapshot,
      statsSnapshot,
      runSnapshot,
      monitorReceiptSnapshot,
      providerSnapshot,
      incidentSnapshot,
      functionLatency,
      billingCostSnapshot,
    ] =
      await Promise.all([
        this.database.collection("households").get(),
        operationsCollection(this.database, "memberAccessStats").get(),
        operationsCollection(this.database, "scheduledJobRuns")
          .orderBy("scheduledFor", "desc")
          .limit(120)
          .get(),
        operationsCollection(this.database, "scheduledJobMonitorReceipts")
          .orderBy("terminalAt", "desc")
          .limit(1)
          .get(),
        operationsCollection(this.database, "providerHealth").get(),
        operationsCollection(this.database, "scheduledJobIncidents")
          .where("state", "==", "OPEN")
          .get(),
        this.functionLatencyReader
          ?.read({
            generatedAt: input.generatedAt,
            windowHours: 24,
          })
          .catch(() => ({
            status: "unavailable" as const,
            windowHours: 24,
            operations: [],
          })) ??
          Promise.resolve({
            status: "unavailable" as const,
            windowHours: 24,
            operations: [],
          }),
        this.database.doc(BILLING_COST_SNAPSHOT_PATH).get(),
      ]);

    const memberSnapshots = await Promise.all(
      householdSnapshot.docs.map((household) =>
        household.ref.collection("members").get(),
      ),
    );
    const dates = recentDates(input.generatedAt, input.rangeDays);
    const today = dates.at(-1) ?? seoulCalendarDate(input.generatedAt);

    const statsByScope = new Map(
      statsSnapshot.docs.flatMap((document) => {
        const data = document.data();
        const householdId = string(data.householdId);
        const memberId = string(data.memberId);
        return householdId === undefined || memberId === undefined
          ? []
          : [[`${householdId}\u0000${memberId}`, data] as const];
      }),
    );

    const households: AdminDashboardHouseholdActivity[] =
      householdSnapshot.docs.flatMap((household, householdIndex) => {
        const data = household.data();
        const name = string(data.name);
        if (name === undefined) return [];
        const members: AdminDashboardMemberActivity[] =
          memberSnapshots[householdIndex].docs.flatMap((member) => {
            const memberData = member.data();
            const displayName = string(memberData.displayName);
            if (displayName === undefined) return [];
            const stats = statsByScope.get(`${household.id}\u0000${member.id}`);
            const dailyCounts = countMap(stats?.dailyAccessCounts);
            return [{
              memberId: member.id,
              displayName,
              lifecycleState:
                memberData.lifecycleState === "removed" ? "removed" : "active",
              linkedPrincipal: string(memberData.linkedPrincipalUid) !== undefined,
              totalAccessCount: count(stats?.totalAccessCount),
              todayAccessCount: dailyCounts[today] ?? 0,
              ...(instant(stats?.lastAccessAt) === undefined
                ? {}
                : { lastAccessAt: instant(stats?.lastAccessAt) }),
              dailyAccess: dates.map((date) => ({
                date,
                count: dailyCounts[date] ?? 0,
              })),
            }];
          });
        members.sort((left, right) =>
          left.displayName.localeCompare(right.displayName, "ko"),
        );
        const householdLastAccessAt = members.reduce<string | undefined>(
          (value, member) => latest(value, member.lastAccessAt),
          undefined,
        );
        return [{
          householdId: household.id,
          name,
          createdAt:
            instant(data.createdAt) ??
            new Date(0).toISOString(),
          lifecycleState:
            data.lifecycleState === "deleted" || data.deletedAt !== undefined
              ? "deleted"
              : "active",
          aggregateVersion: Math.max(1, count(data.aggregateVersion)),
          memberCount: members.filter(
            ({ lifecycleState }) => lifecycleState === "active",
          ).length,
          totalAccessCount: members.reduce(
            (sum, member) => sum + member.totalAccessCount,
            0,
          ),
          todayAccessCount: members.reduce(
            (sum, member) => sum + member.todayAccessCount,
            0,
          ),
          ...(householdLastAccessAt === undefined
            ? {}
            : { lastAccessAt: householdLastAccessAt }),
          members,
        }];
      });
    households.sort((left, right) =>
      left.lifecycleState.localeCompare(right.lifecycleState) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.name.localeCompare(right.name, "ko"),
    );

    const latestRunByName = new Map<string, firestore.DocumentData>();
    for (const document of runSnapshot.docs) {
      const data = document.data();
      const jobName = string(data.jobName);
      if (jobName !== undefined && !latestRunByName.has(jobName)) {
        latestRunByName.set(jobName, data);
      }
    }
    const latestMonitorReceipt = monitorReceiptSnapshot.docs[0]?.data();
    if (latestMonitorReceipt !== undefined) {
      const observedAt =
        instant(latestMonitorReceipt.terminalAt) ??
        instant(latestMonitorReceipt.createdAt);
      latestRunByName.set("scheduled-job-monitor", {
        jobName: "scheduled-job-monitor",
        status: "COMPLETE",
        scheduledFor: observedAt,
        terminalAt: observedAt,
      });
    }
    const scheduledJobs: AdminDashboardScheduledJob[] =
      definitions.definitions.map((definition) => {
        const data = latestRunByName.get(definition.jobName);
        const rawStatus = string(data?.status);
        const latestStatus =
          rawStatus !== undefined && VALID_JOB_STATUS.has(rawStatus)
            ? rawStatus as AdminDashboardScheduledJob["latestStatus"]
            : "UNKNOWN";
        const scheduledFor = instant(data?.scheduledFor);
        const lastUpdatedAt =
          instant(data?.terminalAt) ??
          instant(data?.lastHeartbeatAt) ??
          instant(data?.updatedAt);
        const runTotals = totals(data?.totals);
        return {
          jobName: definition.jobName,
          cron: definition.cron,
          latestStatus,
          ...(scheduledFor === undefined ? {} : { scheduledFor }),
          ...(lastUpdatedAt === undefined ? {} : { lastUpdatedAt }),
          ...(runTotals === undefined ? {} : { totals: runTotals }),
        };
      });

    const providerHealth: AdminDashboardProviderHealth[] =
      providerSnapshot.docs.flatMap((document) => {
        const data = document.data();
        const provider = string(data.provider);
        const operation = string(data.operation);
        const lastAttemptAt = instant(data.lastAttemptAt);
        const status =
          data.status === "healthy" ||
          data.status === "degraded" ||
          data.status === "outage"
            ? data.status
            : undefined;
        if (
          provider === undefined ||
          operation === undefined ||
          lastAttemptAt === undefined ||
          status === undefined
        ) {
          return [];
        }
        return [{
          provider,
          operation,
          status,
          lastAttemptAt,
          ...(instant(data.lastSuccessAt) === undefined
            ? {}
            : { lastSuccessAt: instant(data.lastSuccessAt) }),
          consecutiveFailedRuns: count(data.consecutiveFailedRuns),
          lastResultKind: string(data.lastResultKind) ?? "UNKNOWN",
          ...(string(data.lastErrorCode) === undefined
            ? {}
            : { lastErrorCode: string(data.lastErrorCode) }),
          alertState: data.alertState === "open" ? "open" : "closed",
        }];
      });
    providerHealth.sort((left, right) =>
      left.status.localeCompare(right.status) ||
      left.provider.localeCompare(right.provider),
    );

    const incidents = incidentSnapshot.docs.flatMap((document) => {
      const data = document.data();
      const occurrenceId = string(data.occurrenceId);
      const reason = string(data.reason);
      const openedAt = instant(data.openedAt);
      return occurrenceId === undefined ||
        reason === undefined ||
        openedAt === undefined
        ? []
        : [{
            incidentId: string(data.incidentId) ?? document.id,
            occurrenceId,
            reason,
            openedAt,
          }];
    });

    const dailyAccess: AdminDashboardDailyAccess[] = dates.map((date) => ({
      date,
      count: households.reduce(
        (householdSum, household) =>
          householdSum +
          household.members.reduce(
            (memberSum, member) =>
              memberSum +
              (member.dailyAccess.find((daily) => daily.date === date)?.count ?? 0),
            0,
          ),
        0,
      ),
    }));
    const failedJob = scheduledJobs.some(({ latestStatus }) =>
      latestStatus === "MISSING" ||
      latestStatus === "OVERDUE" ||
      latestStatus === "FAILED" ||
      latestStatus === "PARTIAL_FAILURE",
    );
    const unknownJob = scheduledJobs.some(
      ({ latestStatus }) => latestStatus === "UNKNOWN",
    );
    const providerOutage = providerHealth.some(({ status }) => status === "outage");
    const providerDegraded = providerHealth.some(
      ({ status }) => status === "degraded",
    );
    const health: AdminDashboardHealth =
      incidents.length > 0 || providerOutage
        ? "critical"
        : failedJob || unknownJob || providerDegraded
          ? "degraded"
          : "healthy";

    return {
      generatedAt: input.generatedAt,
      service: {
        apiStatus: "online",
        health,
        ...this.runtime,
      },
      summary: {
        activeHouseholds: households.filter(
          ({ lifecycleState }) => lifecycleState === "active",
        ).length,
        deletedHouseholds: households.filter(
          ({ lifecycleState }) => lifecycleState === "deleted",
        ).length,
        activeMembers: households.reduce(
          (sum, household) => sum + household.memberCount,
          0,
        ),
        todayAccessCount: households.reduce(
          (sum, household) => sum + household.todayAccessCount,
          0,
        ),
        totalAccessCount: households.reduce(
          (sum, household) => sum + household.totalAccessCount,
          0,
        ),
        unhealthyProviders: providerHealth.filter(
          ({ status }) => status !== "healthy",
        ).length,
        openIncidents: incidents.length,
      },
      dailyAccess,
      households,
      scheduledJobs,
      providerHealth,
      incidents,
      functionLatency,
      billingCost: parseAdminDashboardBillingCost(
        billingCostSnapshot.data(),
        input.generatedAt,
      ),
    };
  }
}
