import * as functions from "firebase-functions/v1";
import { getStorage } from "firebase-admin/storage";

import { FirebaseHouseholdCommandMembershipAdapter } from "../adapters/firebase/commands/firebaseHouseholdCommandInfrastructure";
import { FirebaseLedgerCommandRepository } from "../adapters/firebase/ledger/firebaseLedgerCommandRepository";
import {
  FirebaseInstrumentCatalogStorage,
  RemoteInstrumentCatalogRunSource,
} from "../adapters/firebase/portfolio/firebaseInstrumentCatalog";
import { FirebasePortfolioDividendProjectionReader } from "../adapters/firebase/portfolio/firebasePortfolioDividendProjectionReader";
import { FirebasePortfolioInstrumentSearch } from "../adapters/firebase/portfolio/firebasePortfolioInstrumentSearch";
import { FirebasePortfolioMarketData } from "../adapters/firebase/portfolio/firebasePortfolioMarketData";
import { db, REGION } from "../config";
import { createInstrumentCatalogApplication } from "../contexts/portfolio/holdings/application/instrumentCatalogApplication";
import {
  HouseholdQueryRejection,
  requireHouseholdQueryActor,
  type HouseholdQueryResult,
} from "./queries/householdQuery";
import { createHouseholdQueryRouter } from "./queries/householdQueryRouter";
import { createFirebaseShortcutCredentialLifecycle } from "./commands/shortcutCredentialHouseholdCommandHandlers";
import { createShortcutCredentialHouseholdQueryHandlers } from "./queries/shortcutCredentialHouseholdQueryHandlers";
import { createManifestBackedHouseholdQueryRegistry } from "./queries/householdQueryManifest";
import { createPortfolioMarketHouseholdQueryHandlers } from "./queries/portfolioMarketHouseholdQueryHandlers";
import { createAccessHouseholdQueryHandlers } from "./queries/accessHouseholdQueryHandlers";
import { verifiedSystemAdministrator } from "./verifiedSystemAdministrator";

export interface HouseholdQueryWireResponse {
  readonly contractVersion: "household-query-response.v1";
  readonly queryId: string;
  readonly result:
    | { readonly kind: "succeeded"; readonly value: unknown }
    | {
        readonly kind: "rejected";
        readonly error: { readonly code: string; readonly retryable: boolean };
      };
}

function requestQueryId(request: unknown): string {
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    return "invalid-query";
  }
  const queryId = (request as Record<string, unknown>).queryId;
  return typeof queryId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(queryId)
    ? queryId
    : "invalid-query";
}

export function toHouseholdQueryWireResponse(
  request: unknown,
  result: HouseholdQueryResult,
): HouseholdQueryWireResponse {
  const queryId = result.queryId ?? requestQueryId(request);
  return result.kind === "success"
    ? {
        contractVersion: "household-query-response.v1",
        queryId,
        result: { kind: "succeeded", value: result.data },
      }
    : {
        contractVersion: "household-query-response.v1",
        queryId,
        result: {
          kind: "rejected",
          error: { code: result.code, retryable: result.retryable },
        },
      };
}

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

const handlers = createManifestBackedHouseholdQueryRegistry([
  [
    "ledger.get-transaction.v1",
    {
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
        const actor = requireHouseholdQueryActor(context);
        const found = await new FirebaseLedgerCommandRepository(
          db,
          actor.householdId,
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
    quotes: new FirebasePortfolioMarketData(),
    dividends: new FirebasePortfolioDividendProjectionReader(db),
  }),
  ...createAccessHouseholdQueryHandlers(db),
]);

const router = createHouseholdQueryRouter({
  handlers,
  memberships: new FirebaseHouseholdCommandMembershipAdapter(db),
});

export const executeHouseholdQuery = functions
  .region(REGION)
  .runWith({ enforceAppCheck: true })
  .https.onCall(async (data, context): Promise<HouseholdQueryWireResponse> => {
    const result = await router.execute({
      principalUid: context.auth?.uid,
      administrator: verifiedSystemAdministrator(
        context.auth?.uid,
        context.auth?.token,
      ),
      request: data,
    });
    return toHouseholdQueryWireResponse(data, result);
  });
