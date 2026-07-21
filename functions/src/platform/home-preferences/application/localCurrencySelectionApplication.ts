import type {
  LocalCurrencyCardState,
  LocalCurrencySelectionInputPort,
} from "./ports/in/localCurrencySelectionInputPort";
import type {
  HomePreferenceSelectionRepositoryPort,
  LocalCurrencyCandidate,
  LocalCurrencyCandidateQueryPort,
} from "./ports/out/localCurrencySelectionPorts";

const selectionRequired = (): LocalCurrencyCardState => ({
  kind: "NO_DATA",
  reason: "LOCAL_CURRENCY_SELECTION_REQUIRED",
});

function ready(candidate: LocalCurrencyCandidate): LocalCurrencyCardState {
  return {
    kind: "READY",
    type: candidate.type,
    amountInWon: candidate.balanceInWon,
  };
}

export function createLocalCurrencySelectionApplication(dependencies: {
  readonly candidates: LocalCurrencyCandidateQueryPort;
  readonly preferences: HomePreferenceSelectionRepositoryPort;
}): LocalCurrencySelectionInputPort {
  async function resolveSelected(): Promise<LocalCurrencyCandidate | undefined> {
    const candidates = await dependencies.candidates.list();
    const preference = await dependencies.preferences.get();
    if (preference.selectedType !== undefined) {
      return candidates.find(({ type }) => type === preference.selectedType);
    }
    if (candidates.length !== 1) return undefined;

    const only = candidates[0];
    const saved = await dependencies.preferences.compareAndSet({
      expectedVersion: preference.version,
      selectedType: only.type,
    });
    if (saved.kind === "saved") return only;
    return candidates.find(({ type }) => type === saved.current.selectedType);
  }

  return {
    async getCard() {
      const candidate = await resolveSelected();
      return candidate === undefined ? selectionRequired() : ready(candidate);
    },
    async select(input) {
      const candidates = await dependencies.candidates.list();
      if (!candidates.some(({ type }) => type === input.localCurrencyType)) {
        return {
          kind: "validation-error",
          code: "LOCAL_CURRENCY_TYPE_NOT_AVAILABLE",
        };
      }
      const saved = await dependencies.preferences.compareAndSet({
        expectedVersion: input.expectedVersion,
        selectedType: input.localCurrencyType,
      });
      return saved.kind === "conflict"
        ? { kind: "conflict", code: "HOME_CONFIGURATION_VERSION_MISMATCH" }
        : {
            kind: "success",
            selectedType: input.localCurrencyType,
            version: saved.state.version,
          };
    },
    async openSelectedDetail() {
      const selected = await resolveSelected();
      if (selected === undefined) throw new Error("LOCAL_CURRENCY_SELECTION_REQUIRED");
      return {
        intent: "open-local-currency-detail",
        selectedType: selected.type,
        capabilities: {
          canSelectAllTypes: false,
          canSwitchTypeInsideDetail: false,
        },
      };
    },
  };
}
