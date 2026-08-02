import type * as firestore from "firebase-admin/firestore";

import type {
  BillingCostSummary,
  BillingCostSummaryStorePort,
} from "../../../platform/admin-operations/application/billingCostSummary";

export const BILLING_COST_SNAPSHOT_PATH =
  "operations/runtime/billingCostSnapshots/current";

export class FirebaseBillingCostSummaryStore
implements BillingCostSummaryStorePort {
  constructor(private readonly database: firestore.Firestore) {}

  async save(summary: BillingCostSummary): Promise<void> {
    await this.database.doc(BILLING_COST_SNAPSHOT_PATH).set({
      schemaVersion: 1,
      status: "available",
      ...summary,
    });
  }
}
