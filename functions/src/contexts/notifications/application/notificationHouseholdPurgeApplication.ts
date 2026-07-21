import type {
  LifecycleSignalResult,
  NotificationHouseholdPurgeInputPort,
  NotificationPurgePageResult,
  NotificationPurgeSystemActor,
} from "./ports/in/notificationHouseholdPurgePort";
import type {
  NotificationHouseholdPurgeStore,
  StoredNotificationPurgeResult,
} from "./ports/outbound/notificationHouseholdPurgeStore";
import {
  canPurgeNotificationHouseholdData,
  decideNotificationLifecycleSignal,
  nextNotificationPurgeCheckpoint,
} from "../domain/policies/notificationPurgePolicy";

class DefaultNotificationHouseholdPurgeApplication
  implements NotificationHouseholdPurgeInputPort
{
  constructor(private readonly store: NotificationHouseholdPurgeStore) {}

  async handleHouseholdLifecycleSignal(input: {
    eventType: "HouseholdDeleted.v1" | "HouseholdPermanentPurgeRequested.v1";
    householdId: string;
    processId?: string;
  }): Promise<LifecycleSignalResult> {
    return decideNotificationLifecycleSignal(input);
  }

  async purgeHouseholdData(
    actor: NotificationPurgeSystemActor,
    input: {
      householdId: string;
      processId: string;
      checkpoint: string;
    },
  ): Promise<NotificationPurgePageResult> {
    if (!canPurgeNotificationHouseholdData(actor)) {
      return {
        kind: "Forbidden",
        code: "PURGE_SYSTEM_CAPABILITY_REQUIRED",
      };
    }

    return this.store.runPage(input, async (transaction) => {
      const receipt = await transaction.readReceipt();
      if (receipt !== null) {
        return receipt.result;
      }

      const pageSize = this.store.pageSize();
      const candidates = await transaction.listRecordsAfter({
        householdId: input.householdId,
        checkpoint: input.checkpoint,
        limit: pageSize + 1,
      });
      const page = candidates.slice(0, pageSize);
      const hasNextPage = candidates.length > page.length;
      await transaction.deleteRecords(page);

      let result: StoredNotificationPurgeResult;
      if (hasNextPage) {
        const last = page[page.length - 1];
        if (last === undefined) {
          throw new Error("Purge page cannot advance without a record");
        }
        result = {
          kind: "PageProcessed",
          processId: input.processId,
          checkpoint: input.checkpoint,
          nextCheckpoint: nextNotificationPurgeCheckpoint(last),
          deletedCount: page.length,
        };
      } else {
        result = {
          kind: "PurgeCompleted",
          processId: input.processId,
          checkpoint: input.checkpoint,
          deletedCount: page.length,
        };
      }
      await transaction.saveReceipt({
        householdId: input.householdId,
        processId: input.processId,
        checkpoint: input.checkpoint,
        result,
      });
      return result;
    });
  }
}

export function createNotificationHouseholdPurgeApplication(
  store: NotificationHouseholdPurgeStore,
): NotificationHouseholdPurgeInputPort {
  return new DefaultNotificationHouseholdPurgeApplication(store);
}
