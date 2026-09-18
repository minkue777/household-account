import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface IndexField {
  readonly fieldPath: string;
  readonly order?: string;
}

interface IndexConfiguration {
  readonly indexes: readonly {
    readonly collectionGroup: string;
    readonly queryScope: string;
    readonly fields: readonly IndexField[];
  }[];
  readonly fieldOverrides: readonly {
    readonly collectionGroup: string;
    readonly fieldPath: string;
    readonly indexes: readonly {
      readonly order?: string;
      readonly queryScope?: string;
    }[];
  }[];
}

function configuration(): IndexConfiguration {
  return JSON.parse(
    readFileSync(resolve(__dirname, "../../../firestore.indexes.json"), "utf8"),
  ) as IndexConfiguration;
}

describe("Firestore 운영 인덱스 계약", () => {
  it.each([
    ["assetSnapshots", ["byType", "byOwnerRefKey", "ownerDisplayNames", "sourceAssetVersions"]],
    ["dividend_snapshots", ["events", "monthlyData", "monthlyAmounts"]],
  ] as const)("%s의 문서 내부 조회 전용 payload는 하위 필드를 포함해 자동 색인하지 않는다", (collectionGroup, payloadFields) => {
    const config = configuration();
    for (const fieldPath of payloadFields) {
      expect(config.fieldOverrides.filter(candidate => candidate.collectionGroup === collectionGroup && candidate.fieldPath === fieldPath))
        .toEqual([{ collectionGroup, fieldPath, indexes: [] }]);
      // A descendant override or composite index can otherwise reintroduce indexing on a large map.
      expect(config.fieldOverrides.filter(candidate => candidate.collectionGroup === collectionGroup
        && candidate.fieldPath.startsWith(`${fieldPath}.`) && candidate.indexes.length > 0)).toEqual([]);
      expect(config.indexes.filter(candidate => candidate.collectionGroup === collectionGroup
        && candidate.fields.some(field => field.fieldPath === fieldPath || field.fieldPath.startsWith(`${fieldPath}.`)))).toEqual([]);
    }
  });

  it.each([
    ["assetSnapshots", "localDate", ["ASCENDING", "DESCENDING"]],
    ["assetSnapshots", "householdId", ["ASCENDING"]],
    ["dividend_snapshots", "householdId", ["ASCENDING"]],
    ["dividend_snapshots", "year", ["ASCENDING"]],
  ] as const)("%s의 %s 최상위 조회 필드에는 자동 색인을 보존한다", (collectionGroup, fieldPath, orders) => {
    const overrides = configuration().fieldOverrides.filter(candidate => candidate.collectionGroup === collectionGroup);
    const effective = overrides.find(candidate => candidate.fieldPath === fieldPath)
      ?? overrides.find(candidate => candidate.fieldPath === "*");
    // No override inherits Firestore's ascending/descending collection indexes.
    if (effective !== undefined) for (const order of orders) {
      expect(effective.indexes).toContainEqual({ order, queryScope: "COLLECTION" });
    }
  });

  it.each([
    ["recurringPlans", "planId"],
    ["positionHistory", "householdId"],
    ["shortcutCredentials", "secretHash"],
  ] as const)(
    "%s collection-group의 %s equality query 인덱스를 배포 설정에 포함한다",
    (collectionGroup, fieldPath) => {
      const override = configuration().fieldOverrides.find(
        (candidate) =>
          candidate.collectionGroup === collectionGroup &&
          candidate.fieldPath === fieldPath,
      );

      expect(override?.indexes).toContainEqual({
        order: "ASCENDING",
        queryScope: "COLLECTION_GROUP",
      });
    },
  );

  it("due 자산 자동화 collection-group query의 필터·정렬 인덱스를 포함한다", () => {
    const index = configuration().indexes.find(
      (candidate) =>
        candidate.collectionGroup === "assetAutomationPlans" &&
        candidate.queryScope === "COLLECTION_GROUP",
    );

    expect(index?.fields).toEqual([
      { fieldPath: "status", order: "ASCENDING" },
      { fieldPath: "nextDueDate", order: "ASCENDING" },
    ]);
  });
});
