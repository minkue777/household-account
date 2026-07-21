import type { SearchInstrument } from "../../../domain/model/instrumentSearch";

export interface InstrumentCatalogReader {
  domestic(): readonly SearchInstrument[];
  us(): readonly SearchInstrument[];
  crypto(): readonly SearchInstrument[];
}
