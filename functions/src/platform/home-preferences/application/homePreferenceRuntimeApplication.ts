import type {
  HomePreferenceAtomicStorePort,
  HomePreferenceCommandMetadata,
  HomePreferenceCommandState,
} from "./ports/out/homePreferenceAtomicStorePort";
import type { HomeCardType } from "../domain/homeSummary";

export interface HomePreferenceRuntimeCommand {
  readonly actor: { readonly householdId: string; readonly memberId: string };
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly commandName: string;
  readonly payloadFingerprint: string;
  readonly occurredAt: string;
}

export type HomePreferenceRuntimeResult =
  | { readonly kind: "success"; readonly value: Readonly<Record<string, never>> }
  | { readonly kind: "rejected"; readonly code: string; readonly retryable?: true };

const WEB_HOME_CARD_TYPE: Readonly<Record<string, HomeCardType>> = Object.freeze({
  localCurrencyBalance: "LOCAL_CURRENCY_BALANCE",
  monthlyRemainingBudget: "MONTHLY_REMAINING_BUDGET",
  monthlySpent: "MONTHLY_EXPENSE",
  yearlySpent: "YEARLY_EXPENSE",
});

function metadata(input: HomePreferenceRuntimeCommand): HomePreferenceCommandMetadata {
  return {
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    commandName: input.commandName,
    payloadFingerprint: input.payloadFingerprint,
    householdId: input.actor.householdId,
    actorMemberId: input.actor.memberId,
    occurredAt: input.occurredAt,
  };
}

/** 첫 유형만 있을 때만 선택하며 기존 선택은 후보가 늘어나도 절대 바꾸지 않습니다. */
export function autoSelectFirstLocalCurrency(
  current: HomePreferenceCommandState,
  availableTypes: ReadonlySet<string>,
): { readonly selectedType?: string; readonly changed: boolean } {
  if (current.selectedLocalCurrencyType !== undefined) {
    return { selectedType: current.selectedLocalCurrencyType, changed: false };
  }
  if (availableTypes.size !== 1) return { changed: false };
  return { selectedType: [...availableTypes][0], changed: true };
}

function finalResult(
  result: Awaited<ReturnType<HomePreferenceAtomicStorePort["transact"]>>,
): HomePreferenceRuntimeResult {
  if (result.kind === "committed" || result.kind === "replayed") {
    return { kind: "success", value: result.value };
  }
  if (result.kind === "payload-mismatch") {
    return { kind: "rejected", code: "IDEMPOTENCY_PAYLOAD_MISMATCH" };
  }
  if (result.kind === "commit-failed") {
    return { kind: "rejected", code: "ATOMIC_COMMIT_FAILED", retryable: true };
  }
  return {
    kind: "rejected",
    code: "code" in result ? result.code : "HOME_PREFERENCE_COMMAND_REJECTED",
  };
}

export function createHomePreferenceRuntimeApplication(
  store: HomePreferenceAtomicStorePort,
) {
  return {
    async updateSummary(
      input: HomePreferenceRuntimeCommand & {
        readonly leftCard: unknown;
        readonly rightCard: unknown;
      },
    ): Promise<HomePreferenceRuntimeResult> {
      const left =
        typeof input.leftCard === "string"
          ? WEB_HOME_CARD_TYPE[input.leftCard]
          : undefined;
      const right =
        typeof input.rightCard === "string"
          ? WEB_HOME_CARD_TYPE[input.rightCard]
          : undefined;
      if (left === undefined || right === undefined) {
        return { kind: "rejected", code: "UNSUPPORTED_HOME_CARD_TYPE" };
      }
      if (left === right) {
        return { kind: "rejected", code: "DUPLICATE_HOME_CARD_TYPE" };
      }
      return finalResult(
        await store.transact(metadata(input), (current, availableTypes) => {
          const automatic = autoSelectFirstLocalCurrency(current, availableTypes);
          const changed =
            current.left !== left ||
            current.right !== right ||
            automatic.changed;
          return {
            state: {
              ...current,
              left,
              right,
              ...(automatic.selectedType === undefined
                ? {}
                : { selectedLocalCurrencyType: automatic.selectedType }),
              aggregateVersion: changed
                ? current.aggregateVersion + 1
                : current.aggregateVersion,
            },
            value: {},
            writes: changed,
            ...(automatic.changed
              ? { changedField: "auto-local-currency" as const }
              : { changedField: "summary-cards" as const }),
          };
        }),
      );
    },

    async selectLocalCurrency(
      input: HomePreferenceRuntimeCommand & { readonly localCurrencyTypeId: unknown },
    ): Promise<HomePreferenceRuntimeResult> {
      if (
        typeof input.localCurrencyTypeId !== "string" ||
        input.localCurrencyTypeId.trim() === ""
      ) {
        return { kind: "rejected", code: "LOCAL_CURRENCY_TYPE_REQUIRED" };
      }
      const selected = input.localCurrencyTypeId.trim();
      return finalResult(
        await store.transact(metadata(input), (current, availableTypes) => {
          if (!availableTypes.has(selected)) {
            return {
              kind: "rejected",
              code: "LOCAL_CURRENCY_TYPE_NOT_AVAILABLE",
            };
          }
          const changed = current.selectedLocalCurrencyType !== selected;
          return {
            state: {
              ...current,
              selectedLocalCurrencyType: selected,
              aggregateVersion: changed
                ? current.aggregateVersion + 1
                : current.aggregateVersion,
            },
            value: {},
            writes: changed,
            changedField: "local-currency",
          };
        }),
      );
    },
  };
}
