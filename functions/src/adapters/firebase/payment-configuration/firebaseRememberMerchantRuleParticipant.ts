import type * as firestore from "firebase-admin/firestore";
import { rememberExistingTransactionMutation } from "../../../contexts/payment-capture/configuration/public";
import type { FirebaseLedgerCommitParticipant } from "../ledger/firebaseLedgerCommandRepository";
import { FirebasePaymentConfigurationAtomicStore } from "./firebasePaymentConfigurationAtomicStore";

export function createFirebaseRememberMerchantRuleParticipant(database: firestore.Firestore, memberId: string): FirebaseLedgerCommitParticipant {
  const store = new FirebasePaymentConfigurationAtomicStore(database);
  return {
    async prepare(unitOfWork, { current, updated }) {
      if (updated.transactionType !== "expense") return { rejectionCode: "REMEMBER_NOT_AVAILABLE_FOR_INCOME" };
      const originalMerchant = typeof current.originalMerchant === "string" ? current.originalMerchant
        : typeof current.provenance?.originalMerchant === "string" ? current.provenance.originalMerchant
          : typeof current.merchant === "string" ? current.merchant : "";
      const prepared = await store.prepareMerchantRules(unitOfWork, updated.householdId, (state) => rememberExistingTransactionMutation({
        current: state, householdId: updated.householdId, memberId, originalMerchant, categoryId: updated.categoryId,
      }));
      if (prepared.value.kind !== "Created" && prepared.value.kind !== "Updated") {
        return { rejectionCode: "code" in prepared.value ? prepared.value.code : "REMEMBER_RULE_FAILED" };
      }
      return prepared.stage;
    },
  };
}
