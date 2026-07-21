import { createInstrumentSearchApplication } from "../../src/contexts/portfolio/holdings/application/instrumentSearchApplication";
import type { InstrumentCatalogReader } from "../../src/contexts/portfolio/holdings/application/ports/out/instrumentCatalogReader";
import type { SearchInstrument } from "../../src/contexts/portfolio/holdings/public";

export function createInstrumentSearchRankingFixture(seed: {
  domestic: readonly SearchInstrument[];
  us: readonly SearchInstrument[];
  crypto: readonly SearchInstrument[];
}) {
  const copy = (items: readonly SearchInstrument[]) =>
    items.map((item) => ({ ...item }));
  const catalog: InstrumentCatalogReader = {
    domestic: () => copy(seed.domestic),
    us: () => copy(seed.us),
    crypto: () => copy(seed.crypto),
  };

  return createInstrumentSearchApplication(catalog);
}
