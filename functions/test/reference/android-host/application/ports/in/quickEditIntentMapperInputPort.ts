export interface QuickEditIntentExtras {
  readonly transactionId?: string;
  readonly merchant?: string;
  readonly amountInWon?: number;
  readonly categoryId?: string;
  readonly memo?: string;
}

export type QuickEditIntentMappingResult =
  | {
      readonly kind: "Mapped";
      readonly transactionId: string;
      readonly form: {
        readonly merchant: string;
        readonly amountInWon: number;
        readonly categoryId: string;
        readonly memo: string;
      };
      readonly commandsEnabled: true;
      readonly dismissOnOutsideTouch: false;
    }
  | {
      readonly kind: "MissingTransaction";
      readonly form: {
        readonly merchant: string;
        readonly amountInWon: 0;
        readonly categoryId: "etc";
        readonly memo: string;
      };
      readonly commandsEnabled: false;
      readonly dismissOnOutsideTouch: false;
    };

export interface QuickEditIntentMapperInputPort {
  map(extras: QuickEditIntentExtras): QuickEditIntentMappingResult;
}
