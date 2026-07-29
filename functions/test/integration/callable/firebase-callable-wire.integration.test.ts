import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

const PROJECT_ID = "demo-household-account-callable";
const REGION = "asia-northeast3";
const AUTH_API_KEY = "callable-integration-test";
const CALLABLE_TIMEOUT_MILLIS = 30_000;

interface EmulatorAddress {
  readonly host: string;
  readonly port: number;
}

interface AuthSignUpResponse {
  readonly localId: string;
  readonly idToken: string;
}

interface CallableResponse<T> {
  readonly result?: T;
  readonly error?: {
    readonly status?: string;
    readonly message?: string;
  };
}

interface HouseholdCommandWireResponse {
  readonly contractVersion: "household-command-response.v1";
  readonly commandId: string;
  readonly result:
    | { readonly kind: "succeeded"; readonly value: unknown }
    | { readonly kind: "already-processed"; readonly value: unknown }
    | {
        readonly kind: "rejected";
        readonly error: { readonly code: string; readonly retryable: boolean };
      };
}

interface HouseholdQueryWireResponse {
  readonly contractVersion: "household-query-response.v1";
  readonly queryId: string;
  readonly result:
    | { readonly kind: "succeeded"; readonly value: unknown }
    | {
        readonly kind: "rejected";
        readonly error: { readonly code: string; readonly retryable: boolean };
      };
}

interface CreatedHousehold {
  readonly householdId: string;
  readonly memberId: string;
  readonly initializationStatus: string;
}

const describeWithCallableEmulators =
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== undefined &&
  process.env.FIRESTORE_EMULATOR_HOST !== undefined &&
  process.env.FIREBASE_EMULATOR_HUB !== undefined
    ? describe
    : describe.skip;

let app: App;
let database: Firestore;
let functionsOrigin: string;

function httpHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

async function discoverFunctionsOrigin(): Promise<string> {
  const hub = process.env.FIREBASE_EMULATOR_HUB;
  if (hub === undefined) {
    throw new Error("FIREBASE_EMULATOR_HUB is required");
  }
  const response = await fetch(`http://${hub}/emulators`);
  if (!response.ok) {
    throw new Error(`Emulator hub discovery failed: ${response.status}`);
  }
  const emulators = (await response.json()) as Record<string, EmulatorAddress>;
  const functions = emulators.functions;
  if (
    functions === undefined ||
    typeof functions.host !== "string" ||
    typeof functions.port !== "number"
  ) {
    throw new Error("Functions emulator address is unavailable");
  }
  return `http://${httpHost(functions.host)}:${functions.port}`;
}

async function clearEmulators(): Promise<void> {
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (authHost === undefined || firestoreHost === undefined) return;

  const [auth, firestore] = await Promise.all([
    fetch(
      `http://${authHost}/emulator/v1/projects/${PROJECT_ID}/accounts`,
      { method: "DELETE" },
    ),
    fetch(
      `http://${firestoreHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: "DELETE" },
    ),
  ]);
  if (!auth.ok) {
    throw new Error(`Auth emulator clear failed: ${auth.status}`);
  }
  if (!firestore.ok) {
    throw new Error(`Firestore emulator clear failed: ${firestore.status}`);
  }
}

async function signUp(email: string): Promise<AuthSignUpResponse> {
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (authHost === undefined) {
    throw new Error("FIREBASE_AUTH_EMULATOR_HOST is required");
  }
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${AUTH_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password: "callable-test-password",
        returnSecureToken: true,
      }),
    },
  );
  const body = (await response.json()) as
    | AuthSignUpResponse
    | { readonly error?: { readonly message?: string } };
  if (
    !response.ok ||
    !("localId" in body) ||
    typeof body.localId !== "string" ||
    typeof body.idToken !== "string"
  ) {
    throw new Error(`Auth emulator sign-up failed: ${JSON.stringify(body)}`);
  }
  return body;
}

async function callFunction<T>(
  functionName: "executeHouseholdCommand" | "executeHouseholdQuery",
  data: unknown,
  idToken?: string,
): Promise<T> {
  const response = await fetch(
    `${functionsOrigin}/${PROJECT_ID}/${REGION}/${functionName}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(idToken === undefined
          ? {}
          : { authorization: `Bearer ${idToken}` }),
      },
      body: JSON.stringify({ data }),
      signal: AbortSignal.timeout(CALLABLE_TIMEOUT_MILLIS),
    },
  );
  const body = (await response.json()) as CallableResponse<T>;
  if (!response.ok || body.result === undefined) {
    throw new Error(
      `${functionName} callable failed (${response.status}): ${JSON.stringify(body.error ?? body)}`,
    );
  }
  return body.result;
}

function createHouseholdEnvelope(commandId: string) {
  return {
    contractVersion: "household-command.v1",
    commandId,
    idempotencyKey: commandId,
    command: "access.create-household-with-self.v1",
    payload: {
      householdName: "통합 테스트 가계부",
      memberName: "테스트 사용자",
    },
  };
}

async function createHousehold(
  idToken: string,
  commandId: string,
): Promise<CreatedHousehold> {
  const response = await callFunction<HouseholdCommandWireResponse>(
    "executeHouseholdCommand",
    createHouseholdEnvelope(commandId),
    idToken,
  );
  expect(response).toMatchObject({
    contractVersion: "household-command-response.v1",
    commandId,
    result: { kind: "succeeded" },
  });
  if (response.result.kind !== "succeeded") {
    throw new Error(`Household creation was rejected: ${JSON.stringify(response)}`);
  }
  return response.result.value as CreatedHousehold;
}

describeWithCallableEmulators.sequential(
  "Firebase callable/Auth/Firestore 수직 통합",
  () => {
    beforeAll(async () => {
      if (process.env.GCLOUD_PROJECT !== PROJECT_ID) {
        throw new Error(
          `Expected GCLOUD_PROJECT=${PROJECT_ID}, received ${process.env.GCLOUD_PROJECT ?? "undefined"}`,
        );
      }
      functionsOrigin = await discoverFunctionsOrigin();
      app = initializeApp(
        { projectId: PROJECT_ID },
        `callable-wire-${Date.now()}`,
      );
      database = getFirestore(app);
    }, CALLABLE_TIMEOUT_MILLIS);

    beforeEach(clearEmulators, CALLABLE_TIMEOUT_MILLIS);

    afterAll(async () => {
      if (app !== undefined) await deleteApp(app);
    });

    it(
      "인증 토큰이 없으면 callable wire에서 거부하고 Firestore를 변경하지 않는다",
      async () => {
        const response = await callFunction<HouseholdCommandWireResponse>(
          "executeHouseholdCommand",
          createHouseholdEnvelope("unauthenticated-create"),
        );

        expect(response).toEqual({
          contractVersion: "household-command-response.v1",
          commandId: "unauthenticated-create",
          result: {
            kind: "rejected",
            error: { code: "AUTH_REQUIRED", retryable: false },
          },
        });
        expect((await database.collection("households").get()).empty).toBe(true);
      },
      CALLABLE_TIMEOUT_MILLIS,
    );

    it(
      "Auth Emulator의 ID 토큰으로 가계부를 생성하고 canonical membership을 저장한다",
      async () => {
        const auth = await signUp("create-household@example.test");
        const created = await createHousehold(
          auth.idToken,
          "authenticated-create",
        );
        const household = database
          .collection("households")
          .doc(created.householdId);
        const [householdSnapshot, memberSnapshot, membershipSnapshot] =
          await Promise.all([
            household.get(),
            household.collection("members").doc(created.memberId).get(),
            household.collection("memberships").doc(auth.localId).get(),
          ]);

        expect(created.initializationStatus).toBe("completed");
        expect(householdSnapshot.data()).toMatchObject({
          name: "통합 테스트 가계부",
          lifecycleState: "active",
        });
        expect(memberSnapshot.data()).toMatchObject({
          linkedPrincipalUid: auth.localId,
          displayName: "테스트 사용자",
        });
        expect(membershipSnapshot.data()).toMatchObject({
          householdId: created.householdId,
          memberId: created.memberId,
          lifecycleState: "active",
        });
      },
      CALLABLE_TIMEOUT_MILLIS,
    );

    it(
      "인증된 ledger command를 저장한 뒤 query callable이 같은 transaction을 조회한다",
      async () => {
        const auth = await signUp("ledger-round-trip@example.test");
        const created = await createHousehold(auth.idToken, "ledger-household");
        const command = await callFunction<HouseholdCommandWireResponse>(
          "executeHouseholdCommand",
          {
            contractVersion: "household-command.v1",
            commandId: "record-lunch",
            idempotencyKey: "record-lunch",
            householdId: created.householdId,
            command: "ledger.record-manual-transaction.v1",
            payload: {
              transactionType: "expense",
              merchant: "통합 테스트 식당",
              amountInWon: 12_500,
              categoryId: "food",
              accountingDate: "2026-07-29",
              memo: "callable round trip",
            },
          },
          auth.idToken,
        );
        expect(command).toMatchObject({
          contractVersion: "household-command-response.v1",
          commandId: "record-lunch",
          result: { kind: "succeeded" },
        });
        if (command.result.kind !== "succeeded") {
          throw new Error(`Ledger command was rejected: ${JSON.stringify(command)}`);
        }
        const transactionId = (
          command.result.value as { readonly transactionId: string }
        ).transactionId;
        const stored = await database
          .collection("households")
          .doc(created.householdId)
          .collection("ledgerTransactions")
          .doc(transactionId)
          .get();
        expect(stored.data()).toMatchObject({
          householdId: created.householdId,
          merchant: "통합 테스트 식당",
          amountInWon: 12_500,
          categoryId: "food",
          creatorMemberId: created.memberId,
          lifecycleState: "active",
        });

        const query = await callFunction<HouseholdQueryWireResponse>(
          "executeHouseholdQuery",
          {
            contractVersion: "household-query.v1",
            queryId: "read-lunch",
            householdId: created.householdId,
            query: "ledger.get-transaction.v1",
            payload: { transactionId },
          },
          auth.idToken,
        );
        expect(query).toMatchObject({
          contractVersion: "household-query-response.v1",
          queryId: "read-lunch",
          result: {
            kind: "succeeded",
            value: {
              transactionId,
              householdId: created.householdId,
              merchant: "통합 테스트 식당",
              amountInWon: 12_500,
              categoryId: "food",
              creatorMemberId: created.memberId,
            },
          },
        });
      },
      CALLABLE_TIMEOUT_MILLIS,
    );
  },
);
