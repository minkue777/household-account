import type {
  CityGasNotificationInput,
  CityGasParseResult,
} from "../../../domain/model/cityGasBill";

export interface CityGasParserInputPort {
  parse(input: CityGasNotificationInput): CityGasParseResult;
}
