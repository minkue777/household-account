import type { AnnualProjectionView } from "../../../domain/model/dividendProjection";

export interface DividendProjectionStore {
  current(): AnnualProjectionView;
  replace(value: AnnualProjectionView): void;
}
