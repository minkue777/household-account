import type { LedgerTransactionRangeQueryPort } from "../../contexts/household-finance/ledger/application/ports/ledgerTransactionRangeQuery";
import {
  HouseholdQueryRejection,
  requireHouseholdQueryActor,
  type HouseholdQueryHandler,
} from "./householdQuery";

const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u;

function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function createLedgerHouseholdQueryHandlers(
  reader: LedgerTransactionRangeQueryPort,
): ReadonlyMap<string, HouseholdQueryHandler> {
  return new Map<string, HouseholdQueryHandler>([
    [
      "ledger.list-transactions.v1",
      {
        async execute(context) {
          const payload = context.envelope.payload;
          if (
            Object.keys(payload).some(
              (key) => !["startDate", "endDate", "transactionType"].includes(key),
            ) ||
            typeof payload.startDate !== "string" ||
            typeof payload.endDate !== "string" ||
            !isValidDate(payload.startDate) ||
            !isValidDate(payload.endDate) ||
            payload.startDate > payload.endDate ||
            (payload.transactionType !== "expense" &&
              payload.transactionType !== "income")
          ) {
            throw new HouseholdQueryRejection("INVALID_PAYLOAD");
          }
          const actor = requireHouseholdQueryActor(context);
          const transactions = await reader.list({
            householdId: actor.householdId,
            startDate: payload.startDate,
            endDate: payload.endDate,
            transactionType: payload.transactionType,
          });
          return { transactions };
        },
      },
    ],
  ]);
}
