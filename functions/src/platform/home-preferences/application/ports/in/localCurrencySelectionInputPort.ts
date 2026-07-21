export type LocalCurrencyCardState =
  | { readonly kind: "READY"; readonly type: string; readonly amountInWon: number }
  | {
      readonly kind: "NO_DATA";
      readonly reason: "LOCAL_CURRENCY_SELECTION_REQUIRED";
    };

export type SelectLocalCurrencyResult =
  | { readonly kind: "success"; readonly selectedType: string; readonly version: number }
  | { readonly kind: "validation-error"; readonly code: "LOCAL_CURRENCY_TYPE_NOT_AVAILABLE" }
  | { readonly kind: "conflict"; readonly code: "HOME_CONFIGURATION_VERSION_MISMATCH" };

export interface LocalCurrencyDetailNavigation {
  readonly intent: "open-local-currency-detail";
  readonly selectedType: string;
  readonly capabilities: {
    readonly canSelectAllTypes: false;
    readonly canSwitchTypeInsideDetail: false;
  };
}

export interface LocalCurrencySelectionInputPort {
  getCard(): Promise<LocalCurrencyCardState>;
  select(input: {
    readonly localCurrencyType: string;
    readonly expectedVersion: number;
  }): Promise<SelectLocalCurrencyResult>;
  openSelectedDetail(): Promise<LocalCurrencyDetailNavigation>;
}
