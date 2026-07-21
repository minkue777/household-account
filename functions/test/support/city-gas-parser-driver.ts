import {
  createCityGasParser,
  type CityGasParseResult,
  type CityGasParserInputPort,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export type {
  CityGasNotificationInput,
  CityGasParseResult,
  CityGasParserInputPort,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export interface CityGasParserState {
  readonly lastResult?: CityGasParseResult;
}

export interface CityGasParserDriver extends CityGasParserInputPort {
  state(): CityGasParserState;
}

export function createCityGasParserDriver(): CityGasParserDriver {
  const parser = createCityGasParser();
  let lastResult: CityGasParseResult | undefined;

  return {
    parse: (input) => {
      const result = parser.parse(input);
      lastResult = result;
      return result;
    },
    state: () =>
      lastResult === undefined
        ? {}
        : {
            lastResult,
          },
  };
}
