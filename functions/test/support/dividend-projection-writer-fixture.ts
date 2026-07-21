import { createDividendProjectionWriterApplication } from "../../src/contexts/portfolio/dividends/application/dividendProjectionWriterApplication";
import type { DividendProjectionStore } from "../../src/contexts/portfolio/dividends/application/ports/out/dividendProjectionStore";
import type { AnnualProjectionView } from "../../src/contexts/portfolio/dividends/public";

function copy(value: AnnualProjectionView): AnnualProjectionView {
  return {
    ...value,
    monthlyAmounts: [...value.monthlyAmounts],
    events: Object.fromEntries(
      Object.entries(value.events).map(([key, event]) => [key, { ...event }]),
    ),
  };
}

export function createDividendProjectionWriterFixture(seed?: {
  projection?: AnnualProjectionView;
}) {
  let projection = copy(
    seed?.projection ?? {
      monthlyAmounts: Array.from({ length: 12 }, () => 0),
      events: {},
      sourceCheckpoint: "start",
      freshness: "fresh",
    },
  );
  const store: DividendProjectionStore = {
    current: () => copy(projection),
    replace: (value) => {
      projection = copy(value);
    },
  };
  return createDividendProjectionWriterApplication(store);
}
