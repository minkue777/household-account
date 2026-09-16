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
          const household = database
            .collection("households")
            .doc(householdId);
          const [members, memberships] = await Promise.all([
            household.collection("members").get(),
            household.collection("memberships").get(),
          ]);
          const membershipVersions = new Map(
            memberships.docs.map((snapshot) => {
              const data = snapshot.data();
              return [data.memberId, data.aggregateVersion] as const;
            }),
          );
          return {
            members: members.docs.flatMap((snapshot) => {
              const data = snapshot.data();
              if (typeof data.displayName !== "string") return [];
              const lifecycleState =
                data.lifecycleState === "removed" ? "removed" : "active";
              const membershipVersion = membershipVersions.get(snapshot.id);
              return [
                {
                  memberId: snapshot.id,
                  displayName: data.displayName,
                  lifecycleState,
                  // 기존 wire 이름을 유지합니다. 제거·복구의 optimistic token은
                  // 이름 변경으로 증가하는 Member가 아니라 Membership 버전입니다.
                  aggregateVersion:
                    typeof membershipVersion === "number" &&
                    Number.isSafeInteger(membershipVersion)
                      ? membershipVersion
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
