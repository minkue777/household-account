import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

const PROJECT_ID = "demo-household-account-rules";
const HOUSEHOLD_ID = "household-rules-a";
const MEMBER_UID = "uid-member-a";
const OTHER_UID = "uid-member-b";

let environment: RulesTestEnvironment;

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    return;
  }

  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, "../../../../firestore.rules"), "utf8"),
    },
  });

  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(
      doc(
        firestore,
        "households",
        HOUSEHOLD_ID,
        "memberships",
        MEMBER_UID,
      ),
      {
        principalUid: MEMBER_UID,
        householdId: HOUSEHOLD_ID,
        memberId: "member-a",
        lifecycleState: "active",
      },
    );
    await setDoc(doc(firestore, "households", HOUSEHOLD_ID), {
      schemaVersion: 2,
      name: "테스트 가구",
      lifecycleState: "active",
    });
    await setDoc(
      doc(
        firestore,
        "households",
        HOUSEHOLD_ID,
        "ledgerTransactions",
        "transaction-a",
      ),
      {
        schemaVersion: 2,
        householdId: HOUSEHOLD_ID,
        transactionId: "transaction-a",
      },
    );
    await setDoc(doc(firestore, "expenses", "legacy-expense-a"), {
      householdId: HOUSEHOLD_ID,
      amount: 1000,
    });
    await setDoc(doc(firestore, "expenses", "legacy-expense-other"), {
      householdId: "household-rules-other",
      amount: 2000,
    });
    await setDoc(doc(firestore, "notificationEndpoints", "endpoint-a"), {
      householdId: HOUSEHOLD_ID,
      memberId: "member-a",
    });
    await setDoc(doc(firestore, "notification_debug_logs", "debug-a"), {
      householdId: HOUSEHOLD_ID,
    });
  });
});

afterAll(async () => {
  if (environment) {
    await environment.cleanup();
  }
});

const describeWithFirestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST
  ? describe
  : describe.skip;

describeWithFirestoreEmulator("서버 권위형 Firestore Rules", () => {
  it("[T-SEC-001][SYS-001] 인증되지 않은 사용자는 가구와 legacy 금융 데이터를 읽을 수 없다", async () => {
    const firestore = environment.unauthenticatedContext().firestore();

    await assertFails(getDoc(doc(firestore, "households", HOUSEHOLD_ID)));
    await assertFails(getDoc(doc(firestore, "expenses", "legacy-expense-a")));
  });

  it("[T-SEC-001][SYS-001] active Membership은 자기 가구의 공개 모델과 전환 중 legacy 모델만 읽는다", async () => {
    const firestore = environment
      .authenticatedContext(MEMBER_UID)
      .firestore();

    await assertSucceeds(getDoc(doc(firestore, "households", HOUSEHOLD_ID)));
    await assertSucceeds(
      getDoc(
        doc(
          firestore,
          "households",
          HOUSEHOLD_ID,
          "ledgerTransactions",
          "transaction-a",
        ),
      ),
    );
    await assertSucceeds(
      getDoc(doc(firestore, "expenses", "legacy-expense-a")),
    );
  });

  it("[T-SEC-001][SYS-001] 다른 UID는 대상 가구 ID를 알아도 읽을 수 없다", async () => {
    const firestore = environment
      .authenticatedContext(OTHER_UID)
      .firestore();

    await assertFails(getDoc(doc(firestore, "households", HOUSEHOLD_ID)));
    await assertFails(getDoc(doc(firestore, "expenses", "legacy-expense-a")));
  });

  it("[T-SEC-001][SYS-001] active Member도 Canonical·legacy 문서를 Client SDK로 쓸 수 없다", async () => {
    const firestore = environment
      .authenticatedContext(MEMBER_UID)
      .firestore();

    await assertFails(
      setDoc(
        doc(
          firestore,
          "households",
          HOUSEHOLD_ID,
          "ledgerTransactions",
          "transaction-client-write",
        ),
        { householdId: HOUSEHOLD_ID },
      ),
    );
    await assertFails(
      setDoc(doc(firestore, "expenses", "legacy-client-write"), {
        householdId: HOUSEHOLD_ID,
      }),
    );
  });

  it("[T-SEC-001][SYS-001] legacy collection query는 현재 가구 조건이 있을 때만 허용한다", async () => {
    const firestore = environment
      .authenticatedContext(MEMBER_UID)
      .firestore();

    await assertSucceeds(
      getDocs(
        query(
          collection(firestore, "expenses"),
          where("householdId", "==", HOUSEHOLD_ID),
        ),
      ),
    );
    await assertFails(getDocs(collection(firestore, "expenses")));
    await assertFails(
      getDocs(
        query(
          collection(firestore, "expenses"),
          where("householdId", "==", "household-rules-other"),
        ),
      ),
    );
  });

  it("[T-SEC-001] endpoint·receipt·진단 자료는 일반 가구원에게 공개하지 않는다", async () => {
    const firestore = environment
      .authenticatedContext(MEMBER_UID)
      .firestore();

    await assertFails(
      getDoc(doc(firestore, "notificationEndpoints", "endpoint-a")),
    );
    await assertFails(
      getDoc(doc(firestore, "notification_debug_logs", "debug-a")),
    );
  });

  it("[T-SEC-001] 검증된 시스템 관리자만 진단 자료를 읽고 직접 쓰지는 못한다", async () => {
    const firestore = environment
      .authenticatedContext("uid-admin", { systemAdmin: true })
      .firestore();

    await assertSucceeds(
      getDoc(doc(firestore, "notification_debug_logs", "debug-a")),
    );
    await assertFails(
      setDoc(doc(firestore, "notification_debug_logs", "debug-client"), {
        householdId: HOUSEHOLD_ID,
      }),
    );
  });
});
