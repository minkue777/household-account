import type { HtmlQuoteParseResult } from "../../../domain/htmlQuoteContract";

export type HtmlProviderResult = HtmlQuoteParseResult;

export interface HtmlQuoteParsingInputPort {
  parseQuote(input: {
    readonly provider: "domestic-html-provider";
    readonly instrumentCode: string;
    readonly html: string;
    readonly observedOn: string;
  }): HtmlProviderResult;
}
