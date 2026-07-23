import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { principalClaimId } from "../../../src/adapters/firebase/access/firebasePrincipalMembershipClaim";
import { FirebaseHouseholdCommandMembershipAdapter } from "../../../src/adapters/firebase/commands/firebaseHouseholdCommandInfrastructure";

function databaseWith(
  documents: Readonly<Record<string, Record<string, unknown>>>,
) {
  const reads: string[] = [];

  const document = (path: string): unknown => ({
    collection(name: string) {
      return collection(`${path}/${name}`);
    },
    async get() {
      reads.push(path);
      const data = documents[path];
      return {
        exists: data !== undefined,
        data: () => data,
      };
    },
  });
  const collection = (path: string): unknown => ({
    doc(id: string) {
      return document(`${path}/${id}`);
    },
  });
  const database = {
    collection,
  } as unknown as firestore.Firestore;

  return { database, reads };
}

describe("Firebase household command membership fast path", () => {
  it("활성 principal claim 한 문서만으로 actor와 가구 lifecycle을 확인한다", async () => {
    const principalUid = "uid-member-1";
    const claimPath = `principalMembershipClaims/${principalClaimId(principalUid)}`;
    const fixture = databaseWith({
      [claimPath]: {
        principalUid,
        householdId: "household-1",
        memberId: "member-1",
        lifecycleState: "active",
        householdLifecycleState: "active",
      },
    });

    await expect(
      new FirebaseHouseholdCommandMembershipAdapter(
        fixture.database,
      ).resolveActor({
        principalUid,
        householdId: "household-1",
      }),
    ).resolves.toMatchObject({
      kind: "active",
      actor: {
        householdId: "household-1",
        actingMemberId: "member-1",
        capabilities: expect.arrayContaining(["household.write"]),
      },
    });
    expect(fixture.reads).toEqual([claimPath]);
  });

  it("claim에 반영된 가구 삭제 상태를 추가 household read 없이 거부한다", async () => {
    const principalUid = "uid-member-1";
    const claimPath = `principalMembershipClaims/${principalClaimId(principalUid)}`;
    const fixture = databaseWith({
      [claimPath]: {
        principalUid,
        householdId: "household-1",
        memberId: "member-1",
        lifecycleState: "active",
        householdLifecycleState: "deleted",
      },
    });

    await expect(
      new FirebaseHouseholdCommandMembershipAdapter(
        fixture.database,
      ).resolveActor({
        principalUid,
        householdId: "household-1",
      }),
    ).resolves.toEqual({ kind: "household-not-active" });
    expect(fixture.reads).toEqual([claimPath]);
  });
});
