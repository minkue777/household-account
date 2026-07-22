import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import {
  resolveFirebaseSignedInUser,
} from "../../../src/adapters/firebase/access/firebaseSignedInUserResolver";

interface ResolverFixture {
  readonly views?: readonly Record<string, unknown>[];
  readonly membership?: Record<string, unknown>;
  readonly member?: Record<string, unknown>;
  readonly household?: Record<string, unknown>;
}

function snapshot(id: string, data: Record<string, unknown> | undefined) {
  return {
    id,
    exists: data !== undefined,
    data: () => data,
  };
}

function database(fixture: ResolverFixture): Firestore {
  const views = fixture.views ?? [];
  return {
    collection(collectionName: string) {
      if (collectionName === "users") {
        return {
          doc() {
            return {
              collection() {
                return {
                  where() {
                    return {
                      limit() {
                        return {
                          async get() {
                            return {
                              size: views.length,
                              docs: views.map((view, index) =>
                                snapshot(
                                  typeof view.householdId === "string"
                                    ? view.householdId
                                    : `view-${index}`,
                                  view,
                                ),
                              ),
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (collectionName === "households") {
        return {
          doc(householdId: string) {
            return {
              async get() {
                return snapshot(householdId, fixture.household);
              },
              collection(child: string) {
                return {
                  doc(id: string) {
                    return {
                      async get() {
                        return snapshot(
                          id,
                          child === "memberships"
                            ? fixture.membership
                            : fixture.member,
                        );
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected collection: ${collectionName}`);
    },
  } as unknown as Firestore;
}

const principalUid = "uid-1";
const householdId = "household-1";
const memberId = "member-1";

function activeFixture(
  override: Partial<ResolverFixture> = {},
): ResolverFixture {
  return {
    views: [
      {
        principalUid,
        householdId,
        memberId,
        lifecycleState: "active",
      },
    ],
    membership: {
      principalUid,
      householdId,
      memberId,
      lifecycleState: "active",
      status: "active",
      capabilities: ["household.read"],
    },
    member: {
      householdId,
      memberId,
      linkedPrincipalUid: principalUid,
      displayName: "민규",
      lifecycleState: "active",
      aggregateVersion: 3,
    },
    household: { lifecycleState: "active" },
    ...override,
  };
}

describe("Firebase signed-in user resolver", () => {
  it("active view가 없을 때만 first visit으로 해석한다", async () => {
    await expect(
      resolveFirebaseSignedInUser(database({ views: [] }), principalUid),
    ).resolves.toEqual({
      kind: "first-visit-required",
      choices: ["create", "join"],
    });

    await expect(
      resolveFirebaseSignedInUser(
        database({
          views: [
            { principalUid, householdId: "household-1", memberId },
            { principalUid, householdId: "household-2", memberId: "member-2" },
          ],
        }),
        principalUid,
      ),
    ).rejects.toMatchObject({
      code: "MEMBERSHIP_VIEW_INVARIANT_BROKEN",
    });
  });

  it("projection만 남고 canonical membership이 없으면 fail closed한다", async () => {
    await expect(
      resolveFirebaseSignedInUser(
        database(activeFixture({ membership: undefined })),
        principalUid,
      ),
    ).rejects.toMatchObject({
      code: "MEMBERSHIP_CANONICAL_INVARIANT_BROKEN",
    });
  });

  it("canonical membership과 member의 active identity가 모두 일치해야 한다", async () => {
    await expect(
      resolveFirebaseSignedInUser(
        database(
          activeFixture({
            membership: {
              principalUid,
              householdId,
              memberId,
              lifecycleState: "removed",
              status: "removed",
            },
          }),
        ),
        principalUid,
      ),
    ).rejects.toMatchObject({
      code: "MEMBERSHIP_CANONICAL_INVARIANT_BROKEN",
    });

    await expect(
      resolveFirebaseSignedInUser(
        database(
          activeFixture({
            member: {
              householdId,
              memberId,
              linkedPrincipalUid: "uid-other",
              displayName: "민규",
              lifecycleState: "active",
              aggregateVersion: 3,
            },
          }),
        ),
        principalUid,
      ),
    ).rejects.toMatchObject({ code: "MEMBER_PROFILE_INVARIANT_BROKEN" });
  });

  it("검증된 canonical 문서에서만 membership view를 만든다", async () => {
    await expect(
      resolveFirebaseSignedInUser(database(activeFixture()), principalUid),
    ).resolves.toEqual({
      kind: "membership-found",
      membership: {
        householdId,
        memberId,
        displayName: "민규",
        aggregateVersion: 3,
        status: "active",
        capabilities: ["household.read"],
      },
    });
  });
});
