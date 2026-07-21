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
