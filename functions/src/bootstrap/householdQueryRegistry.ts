import type * as firestore from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { FirebaseLedgerCommandRepository } from "../adapters/firebase/ledger/firebaseLedgerCommandRepository";
import {
  FirebaseInstrumentCatalogStorage,
  RemoteInstrumentCatalogRunSource,
} from "../adapters/firebase/portfolio/firebaseInstrumentCatalog";
import { FirebasePortfolioDividendProjectionReader } from "../adapters/firebase/portfolio/firebasePortfolioDividendProjectionReader";
import { FirebasePortfolioInstrumentSearch } from "../adapters/firebase/portfolio/firebasePortfolioInstrumentSearch";
import { FirebasePortfolioMarketData } from "../adapters/firebase/portfolio/firebasePortfolioMarketData";
import { FirebasePortfolioQuoteObservations } from "../adapters/firebase/portfolio/firebasePortfolioQuoteObservations";
import { createInstrumentCatalogApplication } from "../contexts/portfolio/holdings/application/instrumentCatalogApplication";
import { createFirebaseShortcutCredentialLifecycle } from "./commands/shortcutCredentialHouseholdCommandHandlers";
import { createShortcutCredentialHouseholdQueryHandlers } from "./queries/shortcutCredentialHouseholdQueryHandlers";
import { createManifestBackedHouseholdQueryRegistry } from "./queries/householdQueryManifest";
import { createPortfolioMarketHouseholdQueryHandlers } from "./queries/portfolioMarketHouseholdQueryHandlers";
import { createAccessHouseholdQueryHandlers } from "./queries/accessHouseholdQueryHandlers";
import { HouseholdQueryRejection, requireHouseholdReadScope } from "./queries/householdQuery";

export function createFirebaseHouseholdQueryRegistry(db: firestore.Firestore) {
  let portfolioInstrumentSearch: FirebasePortfolioInstrumentSearch | undefined;

  function getPortfolioInstrumentSearch(): FirebasePortfolioInstrumentSearch {
    if (portfolioInstrumentSearch !== undefined) return portfolioInstrumentSearch;
    const bucket = getStorage().bucket();
    const storage = new FirebaseInstrumentCatalogStorage(db, bucket);
    const catalog = createInstrumentCatalogApplication({
      runSource: new RemoteInstrumentCatalogRunSource(bucket),
      publicationStore: storage,
      readStore: storage,
      minimumSourceCounts: { domestic: 3_500, us: 9_000 },
    });
    portfolioInstrumentSearch = new FirebasePortfolioInstrumentSearch(catalog);
    return portfolioInstrumentSearch;
  }

  return createManifestBackedHouseholdQueryRegistry([
    [
      "ledger.get-transaction.v1",
      {
        permitsAdministrator: true,
        async execute(context) {
          const keys = Object.keys(context.envelope.payload);
          const transactionId = context.envelope.payload.transactionId;
          if (
            keys.length !== 1 ||
            typeof transactionId !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(transactionId)
          ) {
            throw new HouseholdQueryRejection("INVALID_PAYLOAD");
          }
          const scope = requireHouseholdReadScope(context);
          const found = await new FirebaseLedgerCommandRepository(
            db,
            scope.householdId,
          ).findTransaction(transactionId);
          if (found.kind === "retryable-failure") {
            throw new HouseholdQueryRejection(found.code, true);
          }
          if (found.value === undefined) {
            throw new HouseholdQueryRejection("NOT_FOUND");
          }
          return found.value;
        },
      },
    ],
    ...createShortcutCredentialHouseholdQueryHandlers(
      createFirebaseShortcutCredentialLifecycle(db),
    ),
    ...createPortfolioMarketHouseholdQueryHandlers({
      search: {
        search: (input) => getPortfolioInstrumentSearch().search(input),
      },
      quotes: new FirebasePortfolioMarketData(undefined, new FirebasePortfolioQuoteObservations(db)),
      dividends: new FirebasePortfolioDividendProjectionReader(db),
    }),
    ...createAccessHouseholdQueryHandlers(db),
  ]);
}
