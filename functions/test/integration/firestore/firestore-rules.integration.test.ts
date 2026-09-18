import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PROJECT_ID = "demo-household-account-rules";
const HOUSEHOLD_ID = "household-rules-a";
const MEMBER_UID = "uid-member-a";
const OTHER_UID = "uid-member-b";
const OTHER_HOUSEHOLD_ID = "household-rules-other";

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
        "assetOwnerProfiles",
        "profile-member-a",
      ),
      {
        householdId: HOUSEHOLD_ID,
        profileId: "profile-member-a",
        displayName: "민규",
        profileType: "member",
        lifecycleState: "active",
        aggregateVersion: 1,
      },
    );
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
    await setDoc(doc(firestore, "households", OTHER_HOUSEHOLD_ID), { lifecycleState: "active" });
    await setDoc(doc(firestore, "households", OTHER_HOUSEHOLD_ID, "memberships", OTHER_UID), { lifecycleState: "active" });
    for (const householdId of [HOUSEHOLD_ID, OTHER_HOUSEHOLD_ID]) {
      await setDoc(doc(firestore, "households", householdId, "categoryCatalog", "current"), {
        schemaVersion: 1, householdId, categories: [{ categoryId: "food", name: "식비", color: "#123456",
          budgetInWon: null, state: "active", sortOrder: 0, version: 1 }], defaultCategoryId: "food", catalogVersion: 1,
      });
      // Only the current catalog is public, even if another operational document exists.
      await setDoc(doc(firestore, "households", householdId, "categoryCatalog", "migration-audit"), { householdId });
      for (const [assetId, positionId] of [["asset-a", "stock-a"], ["asset-b", "crypto-b"]]) {
        await setDoc(doc(firestore, "households", householdId, "assets", assetId, "positions", positionId), {
          householdId, assetId, positionId, quantity: 1, lifecycleState: "active",
        });
      }
    }
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
  it("[T-SEC-001][SYS-001] 단일 카테고리 원본은 자기 가구와 검증된 관리자만 읽으며 다른 문서는 공개하지 않는다", async () => {
    const member = environment.authenticatedContext(MEMBER_UID).firestore();
    const other = environment.authenticatedContext(OTHER_UID).firestore();
    const nonmember = environment.authenticatedContext("uid-no-membership").firestore();
    const anonymous = environment.unauthenticatedContext().firestore();
    const admin = environment.authenticatedContext("catalog-admin", { systemAdmin: true }).firestore();
    const path = `households/${HOUSEHOLD_ID}/categoryCatalog/current`;
    await assertSucceeds(getDoc(doc(member, path)));
    await assertSucceeds(getDoc(doc(admin, path)));
    await assertFails(getDoc(doc(other, path)));
    await assertFails(getDoc(doc(nonmember, path)));
    await assertFails(getDoc(doc(anonymous, path)));
    await assertFails(getDoc(doc(member, `households/${OTHER_HOUSEHOLD_ID}/categoryCatalog/current`)));
    await assertSucceeds(getDoc(doc(other, `households/${OTHER_HOUSEHOLD_ID}/categoryCatalog/current`)));
    for (const db of [member, admin]) {
      await assertFails(getDoc(doc(db, `households/${HOUSEHOLD_ID}/categoryCatalog/migration-audit`)));
      await assertFails(getDocs(collection(db, "households", HOUSEHOLD_ID, "categoryCatalog")));
    }
  });

  it("[T-SEC-001][SYS-001] positions collection-group 조회는 가구 조건과 현재 Membership을 함께 강제한다", async () => {
    const member = environment.authenticatedContext(MEMBER_UID).firestore();
    const other = environment.authenticatedContext(OTHER_UID).firestore();
    const nonmember = environment.authenticatedContext("uid-no-membership").firestore();
    const anonymous = environment.unauthenticatedContext().firestore();
    const admin = environment.authenticatedContext("positions-admin", { systemAdmin: true }).firestore();
    const scoped = (db: typeof member, householdId: string) => query(collectionGroup(db, "positions"), where("householdId", "==", householdId));
    const own = await assertSucceeds(getDocs(scoped(member, HOUSEHOLD_ID)));
    expect(own.docs.map(snapshot => snapshot.id).sort()).toEqual(["crypto-b", "stock-a"]);
    await assertSucceeds(getDocs(scoped(other, OTHER_HOUSEHOLD_ID)));
    await assertSucceeds(getDocs(scoped(admin, HOUSEHOLD_ID)));
    await assertSucceeds(getDocs(scoped(admin, OTHER_HOUSEHOLD_ID)));
    await assertFails(getDocs(collectionGroup(member, "positions")));
    await assertFails(getDocs(scoped(member, OTHER_HOUSEHOLD_ID)));
    await assertFails(getDocs(scoped(other, HOUSEHOLD_ID)));
    await assertFails(getDocs(scoped(nonmember, HOUSEHOLD_ID)));
    await assertFails(getDocs(scoped(anonymous, HOUSEHOLD_ID)));
  });

  it.each([false, true])("[T-SEC-001][SYS-001] 카탈로그와 보유종목의 생성·수정·삭제는 관리자=%s도 Client SDK로 수행하지 못한다", async (systemAdmin) => {
    const db = environment.authenticatedContext(MEMBER_UID, { systemAdmin }).firestore();
    for (const path of [
      `households/${HOUSEHOLD_ID}/categoryCatalog/current`,
      `households/${HOUSEHOLD_ID}/assets/asset-a/positions/stock-a`,
    ]) {
      const reference = doc(db, path);
      await assertFails(setDoc(reference, { householdId: HOUSEHOLD_ID, injected: true }));
      await assertFails(updateDoc(reference, { injected: true }));
      await assertFails(deleteDoc(reference));
    }
    await assertFails(setDoc(doc(db, "households", HOUSEHOLD_ID, "assets", "asset-a", "positions", "new-position"), { householdId: HOUSEHOLD_ID }));
    await assertFails(setDoc(doc(db, "households", HOUSEHOLD_ID, "categoryCatalog", "new-catalog"), { householdId: HOUSEHOLD_ID }));
  });

  it.each(["deleted", "purging", "purged"])("[ADM-003][HH-008][SYS-001] %s 가구는 Membership을 보존해도 일반 읽기를 막고 관리자 조회와 복구를 허용한다", async (lifecycleState) => {
    const householdId = `lifecycle-${lifecycleState}`;
    const legacyId = `expense-${lifecycleState}`;
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "households", householdId), { lifecycleState, name: "삭제된 가구" });
      await setDoc(doc(db, "households", householdId, "memberships", MEMBER_UID), { lifecycleState: "active" });
      await setDoc(doc(db, "households", householdId, "ledgerTransactions", "transaction"), { householdId, amountInWon: 1000 });
      await setDoc(doc(db, "expenses", legacyId), { householdId, amount: 1000 });
    });
    const db = environment.authenticatedContext(MEMBER_UID).firestore();
    const adminDb = environment.authenticatedContext("rules-admin", { systemAdmin: true }).firestore();
    const paths = [
      `households/${householdId}`,
      `households/${householdId}/ledgerTransactions/transaction`,
      `expenses/${legacyId}`,
    ];
    for (const path of paths) {
      await assertFails(getDoc(doc(db, path)));
      await assertSucceeds(getDoc(doc(adminDb, path)));
    }
    await assertFails(getDocs(query(collection(db, "expenses"), where("householdId", "==", householdId))));
    if (lifecycleState === "deleted") {
      await environment.withSecurityRulesDisabled((context) =>
        setDoc(doc(context.firestore(), "households", householdId), { lifecycleState: "active", name: "복구된 가구" }));
      for (const path of paths) await assertSucceeds(getDoc(doc(db, path)));
    }
  });

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
      getDocs(
        collection(
          firestore,
          "households",
          HOUSEHOLD_ID,
          "assetOwnerProfiles",
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
    await assertFails(
      getDocs(
        collection(
          firestore,
          "households",
          HOUSEHOLD_ID,
          "assetOwnerProfiles",
        ),
      ),
    );
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
      setDoc(
        doc(
          firestore,
          "households",
          HOUSEHOLD_ID,
          "assetOwnerProfiles",
          "profile-client-write",
        ),
        {
          householdId: HOUSEHOLD_ID,
          displayName: "클라이언트 생성",
          profileType: "dependent",
          lifecycleState: "active",
        },
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

  it("[T-ADM-003][ADM-004] 시스템 관리자는 다른 가구의 업무 데이터를 조회하지만 수정하지 못한다", async () => {
    const firestore = environment
      .authenticatedContext("uid-admin", { systemAdmin: true })
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
      getDocs(
        query(
          collection(firestore, "expenses"),
          where("householdId", "==", HOUSEHOLD_ID),
        ),
      ),
    );
    await assertFails(
      getDoc(
        doc(
          firestore,
          "households",
          HOUSEHOLD_ID,
          "memberships",
          MEMBER_UID,
        ),
      ),
    );
    await assertFails(
      setDoc(
        doc(
          firestore,
          "households",
          HOUSEHOLD_ID,
          "ledgerTransactions",
          "admin-write",
        ),
        { householdId: HOUSEHOLD_ID },
      ),
    );
  });
});
