import type {
  ParsedObservationClassificationResult,
  ParsedObservationInput,
} from "../../../domain/model/parsedObservationClassification";

export interface ParsedObservationClassificationInputPort {
  classify(
    input: ParsedObservationInput,
  ): ParsedObservationClassificationResult;
}
