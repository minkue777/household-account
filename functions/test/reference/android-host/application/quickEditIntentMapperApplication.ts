import type { QuickEditIntentMapperInputPort } from "./ports/in/quickEditIntentMapperInputPort";

export function createQuickEditIntentMapperApplication(): QuickEditIntentMapperInputPort {
  return {
    map(extras) {
      const merchant = extras.merchant ?? "";
      const memo = extras.memo ?? "";
      if (
        extras.transactionId === undefined ||
        extras.transactionId.trim().length === 0
      ) {
        return {
          kind: "MissingTransaction",
          form: { merchant, amountInWon: 0, categoryId: "etc", memo },
          commandsEnabled: false,
          dismissOnOutsideTouch: false,
        };
      }
      return {
        kind: "Mapped",
        transactionId: extras.transactionId,
        form: {
          merchant,
          amountInWon: extras.amountInWon ?? 0,
          categoryId: extras.categoryId ?? "etc",
          memo,
        },
        commandsEnabled: true,
        dismissOnOutsideTouch: false,
      };
    },
  };
}
