import { createLocalCurrencySelectionApplication } from "../../src/platform/home-preferences/application/localCurrencySelectionApplication";

export function createHomeLocalCurrencySelectionFixture(fixture: {
  readonly candidates: readonly {
    readonly type: string;
    readonly displayName: string;
    readonly balanceInWon: number;
    readonly updatedAt: string;
  }[];
  readonly selectedType?: string;
  readonly version?: number;
}) {
  let state: { selectedType?: string; version: number } = {
    ...(fixture.selectedType === undefined ? {} : { selectedType: fixture.selectedType }),
    version: fixture.version ?? 0,
  };
  const application = createLocalCurrencySelectionApplication({
    candidates: { list: async () => fixture.candidates.map((candidate) => ({ ...candidate })) },
    preferences: {
      async get() {
        return { ...state };
      },
      async compareAndSet(input) {
        if (input.expectedVersion !== state.version) {
          return { kind: "conflict" as const, current: { ...state } };
        }
        state = { selectedType: input.selectedType, version: state.version + 1 };
        return { kind: "saved" as const, state: { ...state } };
      },
    },
  });
  return {
    ...application,
    getPersistedSelection: async () => ({ ...state }),
  };
}
