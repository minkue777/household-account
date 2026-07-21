export interface LocalCurrencyCandidate {
  readonly type: string;
  readonly displayName: string;
  readonly balanceInWon: number;
  readonly updatedAt: string;
}

export interface LocalCurrencyCandidateQueryPort {
  list(): Promise<readonly LocalCurrencyCandidate[]>;
}

export interface HomePreferenceSelectionState {
  readonly selectedType?: string;
  readonly version: number;
}

export interface HomePreferenceSelectionRepositoryPort {
  get(): Promise<HomePreferenceSelectionState>;
  compareAndSet(input: {
    readonly expectedVersion: number;
    readonly selectedType: string;
  }): Promise<
    | { readonly kind: "saved"; readonly state: HomePreferenceSelectionState }
    | { readonly kind: "conflict"; readonly current: HomePreferenceSelectionState }
  >;
}
