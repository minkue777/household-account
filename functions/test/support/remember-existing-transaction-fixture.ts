import { createRememberExistingTransactionApplication } from "../../src/contexts/payment-capture/configuration/application/rememberExistingTransactionApplication";
import type {
  EditableRememberTransaction,
  RememberedExactRule,
} from "../../src/contexts/payment-capture/configuration/application/ports/in/rememberExistingTransactionInputPort";

export function createRememberExistingTransactionFixture(fixture: {
  readonly transactions: readonly EditableRememberTransaction[];
  readonly rules?: readonly RememberedExactRule[];
}) {
  return createRememberExistingTransactionApplication(fixture);
}
