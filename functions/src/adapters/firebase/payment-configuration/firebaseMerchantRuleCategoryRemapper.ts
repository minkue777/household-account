import type * as firestore from "firebase-admin/firestore";
import { FirebasePaymentConfigurationAtomicStore } from "./firebasePaymentConfigurationAtomicStore";
import { createMerchantRuleCategoryArchiveApplication } from "../../../contexts/payment-capture/configuration/public";

export function createFirebaseMerchantRuleCategoryRemapper(database: firestore.Firestore, householdId: string) {
  const application = createMerchantRuleCategoryArchiveApplication(new FirebasePaymentConfigurationAtomicStore(database));
  return {
    remapMerchantRuleReferences(input: { processId: string; sourceCategoryId: string; destinationCategoryId: string }) {
      return application.remap({ ...input, householdId, occurredAt: new Date().toISOString() });
    },
  };
}
