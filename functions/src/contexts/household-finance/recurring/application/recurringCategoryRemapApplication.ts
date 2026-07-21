import {
  decideRecurringCategoryRemap,
  recurringCategoryRemapPayload,
} from "../domain/policies/recurringCategoryRemapPolicy";
import type { RecurringCategoryRemapInputPort } from "./ports/in/recurringCategoryRemapInputPort";
import type {
  RecurringCategoryRemapHashPort,
  RecurringCategoryRemapUnitOfWork,
} from "./ports/out/recurringCategoryRemapPorts";

export function createRecurringCategoryRemapApplication(dependencies: {
  unitOfWork: RecurringCategoryRemapUnitOfWork;
  hash: RecurringCategoryRemapHashPort;
}): RecurringCategoryRemapInputPort {
  return {
    remap(input) {
      const payloadHash = dependencies.hash.hash(
        recurringCategoryRemapPayload(input),
      );
      return dependencies.unitOfWork.transact(input.cursor, (state) =>
        decideRecurringCategoryRemap({ state, ...input, payloadHash }),
      );
    },
  };
}
