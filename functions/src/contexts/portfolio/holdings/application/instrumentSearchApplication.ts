import { rankInstrumentSearch } from "../domain/policies/instrumentSearchRanking";
import type { InstrumentSearch } from "./ports/in/instrumentSearch";
import type { InstrumentCatalogReader } from "./ports/out/instrumentCatalogReader";

export function createInstrumentSearchApplication(
  catalog: InstrumentCatalogReader,
): InstrumentSearch {
  return {
    searchStocks: (query, limit) =>
      rankInstrumentSearch([...catalog.domestic(), ...catalog.us()], query, limit),
    searchCrypto: (query, limit) =>
      rankInstrumentSearch(
        catalog.crypto().filter(({ market }) => market === "UPBIT_KRW"),
        query,
        limit,
      ),
  };
}
