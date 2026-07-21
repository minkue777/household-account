import { createRegisteredCardCommandBoundaryApplication } from "../../src/contexts/payment-capture/configuration/application/registeredCardCommandBoundaryApplication";
import type {
  HistoricalCardEvidence,
  RegisteredCardCommandRecord,
} from "../../src/contexts/payment-capture/configuration/application/ports/in/registeredCardCommandBoundaryInputPort";

export function createRegisteredCardCommandBoundaryFixture(fixture?: {
  readonly cards?: readonly RegisteredCardCommandRecord[];
  readonly historicalEvidence?: readonly HistoricalCardEvidence[];
  readonly collectionVersions?: Readonly<Record<string, number>>;
}) {
  const collectionHousehold = Object.keys(fixture?.collectionVersions ?? {})[0]?.split(":")[0];
  return createRegisteredCardCommandBoundaryApplication({
    boundaryHouseholdId:
      fixture?.cards?.[0]?.householdId ??
      fixture?.historicalEvidence?.[0]?.householdId ??
      collectionHousehold ??
      "household-a",
    ...fixture,
  });
}
