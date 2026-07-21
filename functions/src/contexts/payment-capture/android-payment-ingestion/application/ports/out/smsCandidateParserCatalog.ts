import type { ParsedTransactionEvidence } from "../../../domain/model/parsedObservationClassification";
import type { SmsParserId } from "../../../domain/model/smsParserOrder";

export interface SmsCandidateParserSuccess {
  readonly orderParserId: SmsParserId;
  readonly parserId: string;
  readonly transaction: ParsedTransactionEvidence;
}

export interface SmsCandidateParserCatalog {
  successfulParsers(input: {
    readonly body: string;
    readonly postedAt: string;
  }): readonly SmsCandidateParserSuccess[];
}
