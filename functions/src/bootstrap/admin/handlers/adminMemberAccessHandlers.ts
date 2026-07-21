import type * as firestore from "firebase-admin/firestore";

import { FirebaseMemberLifecycleUnitOfWork } from "../../../adapters/firebase/access/firebaseMemberLifecycleUnitOfWork";
import { createMemberLifecycleApplication } from "../../../contexts/access/member-lifecycle/application/memberLifecycleApplication";
import {
  AdminAccessRejection,
  type AdminAccessHandler,
  type AdminAccessOperation,
} from "../adminAccess";
import {
  exactKeys,
  memberLifecycleCapabilities,
  reject,
  requiredString,
  requiredVersion,
} from "./adminAccessHandlerSupport";

type HandlerEntry = readonly [AdminAccessOperation, AdminAccessHandler];

function memberLifecycleApplication(input: {
  readonly database: firestore.Firestore;
  readonly principalRef: string;
  readonly householdId: string;
  readonly memberId: string;
  readonly operation: "remove" | "restore";
  readonly reason?: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly requestId: string;
}) {
  return createMemberLifecycleApplication({
    unitOfWork: new FirebaseMemberLifecycleUnitOfWork(input.database, {
      administratorPrincipalRef: input.principalRef,
      householdId: input.householdId,
      memberId: input.memberId,
      operation: input.operation,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      idempotencyKey: input.idempotencyKey,
      requestedAt: input.requestedAt,
      commandId: input.requestId,
    }),
  });
}

export function createAdminMemberAccessHandlers(
  database: firestore.Firestore,
): readonly HandlerEntry[] {
  return [
    [
      "list-household-members",
      {
        async execute(context) {
          const payload = context.envelope.payload as Record<string, unknown>;
          if (!exactKeys(payload, ["householdId"])) {
            throw new AdminAccessRejection("INVALID_PAYLOAD");
          }
          const householdId = requiredString(
            payload.householdId,
            "HOUSEHOLD_ID_REQUIRED",
          );
          const members = await database
            .collection("households")
            .doc(householdId)
            .collection("members")
            .get();
          return {
            members: members.docs.flatMap((snapshot) => {
              const data = snapshot.data();
              if (typeof data.displayName !== "string") return [];
              const lifecycleState =
                data.lifecycleState === "removed" ? "removed" : "active";
              return [
                {
                  memberId: snapshot.id,
                  displayName: data.displayName,
                  lifecycleState,
                  aggregateVersion:
                    typeof data.aggregateVersion === "number" &&
                    Number.isSafeInteger(data.aggregateVersion)
                      ? data.aggregateVersion
                      : 1,
                  linkedPrincipal: typeof data.linkedPrincipalUid === "string",
                },
              ];
            }),
          };
        },
      },
    ],
    [
      "remove-household-member",
      {
        async execute(context) {
          const payload = context.envelope.payload as Record<string, unknown>;
          if (
            !exactKeys(payload, [
              "householdId",
              "memberId",
              "reason",
              "expectedVersion",
            ])
          ) {
            throw new AdminAccessRejection("INVALID_PAYLOAD");
          }
          const householdId = requiredString(
            payload.householdId,
            "HOUSEHOLD_ID_REQUIRED",
          );
          const memberId = requiredString(payload.memberId, "MEMBER_ID_REQUIRED");
          const reason = requiredString(payload.reason, "REMOVAL_REASON_REQUIRED");
          const expectedMembershipVersion = requiredVersion(
            payload.expectedVersion,
          );
          const result = await memberLifecycleApplication({
            database,
            principalRef: context.administrator.principalRef,
            householdId,
            memberId,
            operation: "remove",
            reason,
            idempotencyKey: context.envelope.idempotencyKey,
            requestedAt: context.requestedAt,
            requestId: context.envelope.requestId,
          }).removeHouseholdMember(
            {
              principalRef: context.administrator.principalRef,
              capabilities: memberLifecycleCapabilities(
                context.administrator.capabilities,
              ),
            },
            {
              householdId,
              memberId,
              reason,
              expectedMembershipVersion,
              idempotencyKey: context.envelope.idempotencyKey,
            },
          );
          return result.kind === "success" || result.kind === "already-processed"
            ? result
            : reject(result, "ADMIN_MEMBER_REMOVE_FAILED");
        },
      },
    ],
    [
      "restore-household-member",
      {
        async execute(context) {
          const payload = context.envelope.payload as Record<string, unknown>;
          if (!exactKeys(payload, ["householdId", "memberId", "expectedVersion"])) {
            throw new AdminAccessRejection("INVALID_PAYLOAD");
          }
          const householdId = requiredString(
            payload.householdId,
            "HOUSEHOLD_ID_REQUIRED",
          );
          const memberId = requiredString(payload.memberId, "MEMBER_ID_REQUIRED");
          const expectedMembershipVersion = requiredVersion(
            payload.expectedVersion,
          );
          const result = await memberLifecycleApplication({
            database,
            principalRef: context.administrator.principalRef,
            householdId,
            memberId,
            operation: "restore",
            idempotencyKey: context.envelope.idempotencyKey,
            requestedAt: context.requestedAt,
            requestId: context.envelope.requestId,
          }).restoreRemovedHouseholdMember(
            {
              principalRef: context.administrator.principalRef,
              capabilities: memberLifecycleCapabilities(
                context.administrator.capabilities,
              ),
            },
            {
              householdId,
              memberId,
              expectedMembershipVersion,
              idempotencyKey: context.envelope.idempotencyKey,
            },
          );
          return result.kind === "success" || result.kind === "already-processed"
            ? result
            : reject(result, "ADMIN_MEMBER_RESTORE_FAILED");
        },
      },
    ],
  ];
}
