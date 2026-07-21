import type {
  LocalCurrencyMetadataStore,
  LocalCurrencyTransactionIdGenerator,
} from "../ports/localCurrencyMetadataStore";
import type { LocalCurrencyMetadataResult } from "../../domain/model/localCurrencyMetadata";
import { isSelectableLocalCurrencyType } from "../../domain/policies/localCurrencyTypeCompatibility";

export interface LocalCurrencyMetadataCommands {
  recordCaptured(input: {
    actor: { householdId: string; memberId: string };
    commandId: string;
    draft: {
      merchant: string;
      amountInWon: number;
      captureLineageId: string;
      captureKind: "local-currency" | "card";
      verifiedLocalCurrencyType?: string;
    };
  }): Promise<LocalCurrencyMetadataResult>;
  recordManual(input: {
    actor: { householdId: string; memberId: string };
    commandId: string;
    merchant: string;
    amountInWon: number;
    requestedLocalCurrencyType?: string;
  }): Promise<LocalCurrencyMetadataResult>;
  update(input: {
    actor: { householdId: string; memberId: string };
    commandId: string;
    transactionId: string;
    expectedVersion: number;
    patch: { merchant?: string; localCurrencyType?: string | null };
  }): Promise<LocalCurrencyMetadataResult>;
}

export function createLocalCurrencyMetadataCommands(input: {
  store: LocalCurrencyMetadataStore;
  idGenerator: LocalCurrencyTransactionIdGenerator;
}): LocalCurrencyMetadataCommands {
  return {
    recordCaptured: async (command) => {
      const replay = await input.store.findReceipt(command.commandId);
      if (replay !== undefined) return replay;
      if (command.draft.captureKind === "local-currency") {
        if (
          command.draft.verifiedLocalCurrencyType === undefined ||
          !isSelectableLocalCurrencyType(
            command.draft.verifiedLocalCurrencyType,
          )
        ) {
          return {
            kind: "ValidationError",
            code: "LOCAL_CURRENCY_TYPE_REQUIRED",
          };
        }
      } else if (command.draft.verifiedLocalCurrencyType !== undefined) {
        return {
          kind: "ValidationError",
          code: "LOCAL_CURRENCY_TYPE_NOT_CAPTURE_VERIFIED",
        };
      }
      const transaction = {
        transactionId: input.idGenerator.next(command.commandId),
        householdId: command.actor.householdId,
        merchant: command.draft.merchant,
        amountInWon: command.draft.amountInWon,
        ...(command.draft.verifiedLocalCurrencyType === undefined
          ? {}
          : {
              localCurrencyType: command.draft.verifiedLocalCurrencyType,
            }),
        captureLineageId: command.draft.captureLineageId,
        aggregateVersion: 1,
      };
      const result = { kind: "Recorded" as const, transaction };
      const current = await input.store.load();
      const committed = await input.store.commit({
        commandId: command.commandId,
        transactions: [...current, transaction],
        result,
      });
      return committed.kind === "success" ? result : committed;
    },

    recordManual: async (command) => {
      const replay = await input.store.findReceipt(command.commandId);
      if (replay !== undefined) return replay;
      if (command.requestedLocalCurrencyType !== undefined) {
        return {
          kind: "ValidationError",
          code: "LOCAL_CURRENCY_TYPE_NOT_CAPTURE_VERIFIED",
        };
      }
      const transaction = {
        transactionId: input.idGenerator.next(command.commandId),
        householdId: command.actor.householdId,
        merchant: command.merchant,
        amountInWon: command.amountInWon,
        aggregateVersion: 1,
      };
      const result = { kind: "Recorded" as const, transaction };
      const current = await input.store.load();
      const committed = await input.store.commit({
        commandId: command.commandId,
        transactions: [...current, transaction],
        result,
      });
      return committed.kind === "success" ? result : committed;
    },

    update: async (command) => {
      const replay = await input.store.findReceipt(command.commandId);
      if (replay !== undefined) return replay;
      const current = await input.store.load();
      const transaction = current.find(
        (candidate) =>
          candidate.transactionId === command.transactionId &&
          candidate.householdId === command.actor.householdId,
      );
      if (transaction === undefined) return { kind: "NotFound" };
      if (transaction.aggregateVersion !== command.expectedVersion) {
        return { kind: "Conflict", code: "VERSION_MISMATCH" };
      }
      if (
        Object.prototype.hasOwnProperty.call(
          command.patch,
          "localCurrencyType",
        ) &&
        command.patch.localCurrencyType !== transaction.localCurrencyType
      ) {
        return {
          kind: "ValidationError",
          code: "LOCAL_CURRENCY_TYPE_IMMUTABLE",
        };
      }
      const changed = {
        ...transaction,
        ...(command.patch.merchant === undefined
          ? {}
          : { merchant: command.patch.merchant }),
        aggregateVersion: transaction.aggregateVersion + 1,
      };
      const result = { kind: "Updated" as const, transaction: changed };
      const committed = await input.store.commit({
        commandId: command.commandId,
        expectedVersion: {
          transactionId: transaction.transactionId,
          version: command.expectedVersion,
        },
        transactions: current.map((candidate) =>
          candidate.transactionId === changed.transactionId
            ? changed
            : { ...candidate },
        ),
        result,
      });
      return committed.kind === "success" ? result : committed;
    },
  };
}
