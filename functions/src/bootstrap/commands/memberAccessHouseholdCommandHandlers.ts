import type * as firestore from "firebase-admin/firestore";

import { FirebaseMemberAccessStore } from "../../adapters/firebase/operations/firebaseMemberAccessStore";
import type { MemberAccessPlatform } from "../../platform/usage-observability/public";
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

function payloadRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HouseholdCommandRejection("INVALID_PAYLOAD");
  }
  return value as Record<string, unknown>;
}

export function createMemberAccessHouseholdCommandHandlers(
  database: firestore.Firestore,
): readonly (readonly [string, HouseholdCommandHandler])[] {
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
              (key) => key !== "visitId" && key !== "platform",
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
          return new FirebaseMemberAccessStore(database).record({
            householdId: context.actor.householdId,
            memberId: context.actor.actingMemberId,
            visitId: payload.visitId,
            platform: payload.platform as MemberAccessPlatform,
            accessedAt: context.requestedAt,
          });
        },
      },
    ],
  ];
}
