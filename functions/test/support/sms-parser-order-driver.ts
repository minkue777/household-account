import {
  createSmsParserOrderPolicy,
  type SmsParserId,
  type SmsParserOrderInputPort,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export type {
  SelectSmsParserInput,
  SmsParserId,
  SmsParserOrderInputPort,
  SmsParserOrderResult,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export interface SmsParserOrderState {
  readonly selectedParserId?: SmsParserId;
  readonly unsupportedInternalParserIds: readonly SmsParserId[];
}

export interface SmsParserOrderDriver extends SmsParserOrderInputPort {
  state(): SmsParserOrderState;
}

function unsupportedParserIds(
  parserIds: readonly SmsParserId[],
): readonly SmsParserId[] {
  return [...new Set(parserIds.filter((parserId) => parserId === "Sejong"))];
}

export function createSmsParserOrderDriver(): SmsParserOrderDriver {
  const policy = createSmsParserOrderPolicy();
  let state: SmsParserOrderState = {
    selectedParserId: undefined,
    unsupportedInternalParserIds: [],
  };

  return {
    select: (input) => {
      const result = policy.select(input);
      state = {
        selectedParserId:
          result.kind === "Selected" ? result.parserId : undefined,
        unsupportedInternalParserIds: unsupportedParserIds(
          input.successfulParserIds,
        ),
      };
      return result;
    },
    state: () => ({
      ...state,
      unsupportedInternalParserIds: [...state.unsupportedInternalParserIds],
    }),
  };
}
