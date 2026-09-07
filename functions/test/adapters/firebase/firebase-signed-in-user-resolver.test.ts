import type { Firestore } from "firebase-admin/firestore";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveFirebaseSignedInUser,
} from "../../../src/adapters/firebase/access/firebaseSignedInUserResolver";
import { issueWebViewSessionToken } from "../../../src/bootstrap/firebaseWebViewSession";

interface ResolverFixture {
  readonly views?: readonly Record<string, unknown>[];
  readonly membership?: Record<string, unknown>;
  readonly member?: Record<string, unknown>;
  readonly household?: Record<string, unknown>;
  readonly beforeDocumentRead?: (path: string) => Promise<void>;
  readonly reverseBatchResults?: boolean;
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
    async getAll(...references: { get: () => Promise<ReturnType<typeof snapshot>> }[]) {
      const documents = await Promise.all(references.map(reference => reference.get()));
      return fixture.reverseBatchResults ? documents.reverse() : documents;
    },
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
              path: `households/${householdId}`,
              async get() {
                await fixture.beforeDocumentRead?.(`households/${householdId}`);
                return snapshot(householdId, fixture.household);
              },
              collection(child: string) {
                return {
                  doc(id: string) {
                    return {
                      path: `households/${householdId}/${child}/${id}`,
                      async get() {
                        await fixture.beforeDocumentRead?.(`households/${householdId}/${child}/${id}`);
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
  afterEach(() => vi.unstubAllEnvs());
  it.each([true, false])("active view가 없으면 first visit과 legacy 전환 허용=%s를 반환한다", async enabled => {
    vi.stubEnv('LEGACY_MEMBERSHIP_CLAIM_ENABLED', String(enabled));
    await expect(
      resolveFirebaseSignedInUser(database({ views: [] }), principalUid),
    ).resolves.toEqual({
      kind: "first-visit-required",
      choices: ["create", "join"],
      legacyClaimEnabled: enabled,
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

  it("이미 읽은 가구 read model을 함께 반환해 클라이언트의 중복 조회를 없앤다", async () => {
    await expect(
      resolveFirebaseSignedInUser(
        database(activeFixture({
          household: {
            lifecycleState: "active",
            name: "또니망고네 가계부",
            createdAt: { toDate: () => new Date("2026-07-23T00:00:00.000Z") },
            defaultCategoryKey: "etc",
            homeSummaryConfig: {
              leftCard: "monthlySpent",
              rightCard: "yearlySpent",
            },
            members: [
              { id: memberId, name: "민규", aggregateVersion: 3 },
              { id: "member-2", name: "진선", aggregateVersion: 2 },
            ],
          },
        })),
        principalUid,
      ),
    ).resolves.toMatchObject({
      kind: "membership-found",
      household: {
        id: householdId,
        name: "또니망고네 가계부",
        createdAt: "2026-07-23T00:00:00.000Z",
        defaultCategoryKey: "etc",
        members: [
          { id: memberId, name: "민규", aggregateVersion: 3 },
          { id: "member-2", name: "진선", aggregateVersion: 2 },
        ],
      },
    });
  });

  it("batches the same canonical membership, member and household references once", async () => {
    const source = database(activeFixture());
    const batch = vi.spyOn(source, "getAll");
    await resolveFirebaseSignedInUser(source, principalUid);
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0].map(reference => "path" in reference ? reference.path : undefined)).toEqual([
      `households/${householdId}/memberships/${principalUid}`,
      `households/${householdId}/members/${memberId}`,
      `households/${householdId}`,
    ]);
  });

  it.each([
    { views: [] },
    { views: [{ principalUid, householdId, memberId }, { principalUid, householdId: "other", memberId }] },
    { views: [{ principalUid: "other", householdId, memberId }] },
  ])("does not read canonical data until the active projection is uniquely valid: %j", async fixture => {
    const source = database(fixture);
    const batch = vi.spyOn(source, "getAll");
    if (fixture.views.length === 0) {
      await expect(resolveFirebaseSignedInUser(source, principalUid)).resolves.toMatchObject({ kind: "first-visit-required" });
    } else {
      await expect(resolveFirebaseSignedInUser(source, principalUid)).rejects.toMatchObject({ code: "MEMBERSHIP_VIEW_INVARIANT_BROKEN" });
    }
    expect(batch).not.toHaveBeenCalled();
  });

  it.each([
    ["membership", "MEMBERSHIP_CANONICAL_INVARIANT_BROKEN"],
    ["member", "MEMBER_PROFILE_INVARIANT_BROKEN"],
    ["household", "HOUSEHOLD_NOT_ACTIVE"],
  ] as const)("fails closed when the batch confirms a missing %s", async (field, code) => {
    const source = database(activeFixture({ [field]: undefined }));
    await expect(resolveFirebaseSignedInUser(source, principalUid)).rejects.toMatchObject({ code });
  });

  it.each([
    ["membership", "householdId", "MEMBERSHIP_CANONICAL_INVARIANT_BROKEN"],
    ["membership", "principalUid", "MEMBERSHIP_CANONICAL_INVARIANT_BROKEN"],
    ["member", "householdId", "MEMBER_PROFILE_INVARIANT_BROKEN"],
    ["member", "linkedPrincipalUid", "MEMBER_PROFILE_INVARIANT_BROKEN"],
  ] as const)("still rejects mismatched %s.%s after batching", async (record, field, code) => {
    const fixture = activeFixture();
    const source = database({ ...fixture, [record]: { ...fixture[record], [field]: "other" } });
    await expect(resolveFirebaseSignedInUser(source, principalUid)).rejects.toMatchObject({ code });
  });

  it("rejects mismatched document schemas if a provider returns the batch in the wrong order", async () => {
    const source = database(activeFixture({ reverseBatchResults: true }));
    await expect(resolveFirebaseSignedInUser(source, principalUid)).rejects.toMatchObject({ code: "MEMBERSHIP_CANONICAL_INVARIANT_BROKEN" });
  });

  it.each(["memberships", "members", "household"])(
    "does not resolve or issue either token until the %s document completes", async delayed => {
      let release!: () => void;
      const pendingDocument = new Promise<void>(resolve => { release = resolve; });
      const paths: string[] = [];
      const delayedPath = delayed === "household" ? `households/${householdId}`
        : `households/${householdId}/${delayed}/${delayed === "members" ? memberId : principalUid}`;
      const source = database(activeFixture({ beforeDocumentRead: async path => {
        paths.push(path);
        if (path === delayedPath) await pendingDocument;
      } }));
      const issue = vi.fn(async () => "local-test-token");
      const pending = issueWebViewSessionToken({
        principalUid, issue,
        resolveSignedInUser: uid => resolveFirebaseSignedInUser(source, uid),
      });
      await vi.waitFor(() => expect(paths).toHaveLength(3));
      expect(issue).not.toHaveBeenCalled();
      release();
      await expect(pending).resolves.toMatchObject({ principalUid, signedInUserResolution: { kind: "membership-found" } });
      expect(issue).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["memberships", "members", "household"])(
    "rejects a failed %s document without issuing either token", async failed => {
      const failedPath = failed === "household" ? `households/${householdId}`
        : `households/${householdId}/${failed}/${failed === "members" ? memberId : principalUid}`;
      const source = database(activeFixture({ beforeDocumentRead: async path => {
        if (path === failedPath) throw new Error("DOCUMENT_READ_UNAVAILABLE");
      } }));
      const issue = vi.fn(async () => "must-not-issue");
      await expect(issueWebViewSessionToken({
        principalUid, issue,
        resolveSignedInUser: uid => resolveFirebaseSignedInUser(source, uid),
      })).rejects.toThrow("DOCUMENT_READ_UNAVAILABLE");
      expect(issue).not.toHaveBeenCalled();
    },
  );
});
