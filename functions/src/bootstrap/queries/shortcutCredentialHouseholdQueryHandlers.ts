import type { ShortcutCredentialLifecycleInputPort } from "../../contexts/payment-capture/shortcut-ingestion/application/ports/in/shortcutCredentialLifecycleInputPort";
import {
  HouseholdQueryRejection,
  requireHouseholdQueryActor,
  type HouseholdQueryHandler,
} from "./householdQuery";

export function createShortcutCredentialHouseholdQueryHandlers(
  lifecycle: ShortcutCredentialLifecycleInputPort,
): ReadonlyMap<string, HouseholdQueryHandler> {
  return new Map([
    [
      "shortcut.get-credential-status.v1",
      {
        async execute(context) {
          if (Object.keys(context.envelope.payload).length !== 0) {
            throw new HouseholdQueryRejection("INVALID_PAYLOAD");
          }
          const actor = requireHouseholdQueryActor(context);
          const result = await lifecycle.getStatus({
            session: {
              principalUid: context.principalUid,
              householdId: actor.householdId,
              memberId: actor.actingMemberId,
              membershipState: "active",
              householdState: "active",
            },
          });
          if (result.kind === "forbidden") {
            throw new HouseholdQueryRejection(result.code);
          }
          return result;
        },
      },
    ],
  ]);
}
