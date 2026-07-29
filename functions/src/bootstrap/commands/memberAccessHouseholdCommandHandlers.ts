import type * as firestore from "firebase-admin/firestore";

import { FirebaseMemberAccessStore } from "../../adapters/firebase/operations/firebaseMemberAccessStore";
import type {
  MemberAccessEvent,
  MemberAccessPlatform,
} from "../../platform/usage-observability/public";
import {
  recordCompletedInteractiveLatency,
  type InteractiveLatencyEndpoint,
  type InteractiveLatencyStatus,
} from "../../observability/interactiveLatency";
import {
  HouseholdCommandRejection,
  type HouseholdCommandHandler,
} from "./householdCommand";

const VISIT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const PLATFORMS = new Set<MemberAccessPlatform>([
  "android",
  "ios-pwa",
  "web",
]);
const MAX_STARTUP_DURATION_MS = 2 * 60 * 1_000;

function startupDuration(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_STARTUP_DURATION_MS
  ) {
    throw new HouseholdCommandRejection("INVALID_PAYLOAD");
  }
  return Math.round(value * 1_000) / 1_000;
}

function startupOperation(
  platform: MemberAccessPlatform,
): string | undefined {
  if (platform === "android") {
    return "client.android-app-first-home-complete-paint.v1";
  }
  if (platform === "ios-pwa") {
    return "client.ios-pwa-first-home-complete-paint.v1";
  }
  return undefined;
}

function payloadRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HouseholdCommandRejection("INVALID_PAYLOAD");
  }
  return value as Record<string, unknown>;
}

export function createMemberAccessHouseholdCommandHandlers(
  database: firestore.Firestore,
  dependencies: {
    readonly recordAccess?: (
      event: MemberAccessEvent,
    ) => Promise<{
      readonly kind: "recorded" | "already-recorded";
      readonly totalAccessCount: number;
    }>;
    readonly recordLatency?: (input: {
      readonly endpoint: InteractiveLatencyEndpoint;
      readonly operation: string;
      readonly elapsedMs: number;
      readonly status: InteractiveLatencyStatus;
    }) => void;
  } = {},
): readonly (readonly [string, HouseholdCommandHandler])[] {
  const recordAccess = dependencies.recordAccess ??
    ((event: MemberAccessEvent) =>
      new FirebaseMemberAccessStore(database).record(event));
  const recordLatency =
    dependencies.recordLatency ?? recordCompletedInteractiveLatency;
  return [
    [
      "access.record-app-visit.v1",
      {
        idempotencyBoundary: "domain-idempotency-key",
        async execute(context) {
          if (context.actor === undefined) {
            throw new HouseholdCommandRejection("MEMBERSHIP_REQUIRED");
          }
          const payload = payloadRecord(context.envelope.payload);
          if (
            Object.keys(payload).some(
              (key) =>
                key !== "visitId" &&
                key !== "platform" &&
                key !== "clientStartupDurationMs",
            ) ||
            typeof payload.visitId !== "string" ||
            !VISIT_ID.test(payload.visitId) ||
            context.envelope.commandId !== payload.visitId ||
            context.envelope.idempotencyKey !== payload.visitId ||
            typeof payload.platform !== "string" ||
            !PLATFORMS.has(payload.platform as MemberAccessPlatform)
          ) {
            throw new HouseholdCommandRejection("INVALID_PAYLOAD");
          }
          const platform = payload.platform as MemberAccessPlatform;
          const durationMs = startupDuration(payload.clientStartupDurationMs);
          if (platform === "web" && durationMs !== undefined) {
            throw new HouseholdCommandRejection("INVALID_PAYLOAD");
          }
          const result = await recordAccess({
            householdId: context.actor.householdId,
            memberId: context.actor.actingMemberId,
            visitId: payload.visitId,
            platform,
            accessedAt: context.requestedAt,
          });
          const operation = startupOperation(platform);
          if (
            result.kind === "recorded" &&
            durationMs !== undefined &&
            operation !== undefined
          ) {
            try {
              recordLatency({
                endpoint: "clientStartup",
                operation,
                elapsedMs: durationMs,
                status: "succeeded",
              });
            } catch {
              // 운영 계측 실패가 이미 완료된 접속 기록을 실패로 바꾸지 않습니다.
            }
          }
          return result;
        },
      },
    ],
  ];
}
