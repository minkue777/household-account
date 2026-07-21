import type { InstrumentSearchResult } from "../../../domain/model/instrumentSearch";

export interface InstrumentSearch {
  searchStocks(query: string, limit?: number): InstrumentSearchResult;
  searchCrypto(query: string, limit?: number): InstrumentSearchResult;
}
