import { describe, expect, it } from "vitest";
import type {
  CategoryCatalogInputPort,
  CategoryView,
} from "../../../../src/contexts/household-finance/categories-budget/public";
import {
  createCategoryCatalogFixtureSubject,
  type CategoryCatalogFixture,
  type CategoryCatalogFixtureState,
} from "../../../support/category-catalog-fixture";

export interface CategoryCatalogSubject extends CategoryCatalogInputPort {
  publicCommands(): readonly string[];
  state(): CategoryCatalogFixtureState;
}

export function createSubject(
  fixture: CategoryCatalogFixture = {},
): CategoryCatalogSubject {
  return createCategoryCatalogFixtureSubject(fixture);
}

function category(
  categoryId: string,
  overrides: Partial<CategoryView> = {},
): CategoryView {
  return {
    categoryId,
    name: categoryId,
    color: "#000000",
    budgetInWon: null,
    state: "active",
    sortOrder: 0,
    version: 1,
    ...overrides,
  };
}

describe("Category Catalog 공개 계약", () => {
  it("[T-CAT-001][CAT-001] 빈 가구만 결정적 기본 다섯 카테고리를 지정 순서로 초기화한다", async () => {
    const result = await createSubject().initializeDefaults("init-1");

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.value.map(({ name }) => name)).toEqual([
        "생활비",
        "육아비",
        "고정비",
        "식비",
        "기타",
      ]);
      expect(result.value.map(({ sortOrder }) => sortOrder)).toEqual([
        0, 1, 2, 3, 4,
      ]);
      expect(new Set(result.value.map(({ categoryId }) => categoryId)).size).toBe(5);
    }
  });

  it("[T-CAT-001][CAT-001] 일부 카테고리가 있으면 누락 기본값을 임의 보충하지 않는다", async () => {
    const existing = category("custom", { name: "직접 만든 항목" });
    const subject = createSubject({ state: { categories: [existing] } });

    const result = await subject.initializeDefaults("init-partial");

    expect(result).toEqual({ kind: "already-processed", value: [existing] });
    expect(subject.state().categories).toEqual([existing]);
  });

  it("[T-CAT-002][CAT-001] 동시 초기화도 기본 categoryId별 한 건에 수렴한다", async () => {
    const subject = createSubject();

    await Promise.all([
      subject.initializeDefaults("init-a"),
      subject.initializeDefaults("init-b"),
    ]);

    const state = subject.state();
    expect(state.categories).toHaveLength(5);
    expect(new Set(state.categories.map(({ categoryId }) => categoryId)).size).toBe(5);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "[T-CAT-003][CAT-002] 잘못된 예산 %s은 0원으로 바꾸지 않고 저장 전에 거부한다",
    async (budgetInWon) => {
      const subject = createSubject();

      const result = await subject.createCategory({
        commandKey: "create-invalid",
        name: "여가",
        color: "#123456",
        budgetInWon,
      });

      expect(result).toEqual({
        kind: "validation-error",
        code: "INVALID_CATEGORY_BUDGET",
      });
      expect(subject.state().categories).toEqual([]);
    },
  );

  it("[T-CAT-003][CAT-002] 예산 미입력은 0원이 아니라 null로 보존한다", async () => {
    const result = await createSubject().createCategory({
      commandKey: "create-null-budget",
      name: "여가",
      color: "#123456",
    });

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({ budgetInWon: null }),
    });
  });

  it("[T-CAT-003][CAT-002] 이름·색상·0원 예산 수정은 같은 ID의 version만 증가시키고 최종 상태에 반영한다", async () => {
    const existing = category("food", {
      name: "식비",
      color: "#111111",
      budgetInWon: 100_000,
      version: 3,
    });
    const subject = createSubject({ state: { categories: [existing] } });

    const result = await subject.updateCategory({
      commandKey: "update-food",
      categoryId: "food",
      expectedVersion: 3,
      name: "외식비",
      color: "#abcdef",
      budgetInWon: 0,
    });

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({
        categoryId: "food",
        name: "외식비",
        color: "#abcdef",
        budgetInWon: 0,
        version: 4,
      }),
    });
    expect(subject.state().categories).toContainEqual(
      expect.objectContaining({
        categoryId: "food",
        name: "외식비",
        color: "#abcdef",
        budgetInWon: 0,
        version: 4,
      }),
    );
  });

  it("[T-CAT-003][CAT-002] 순서 변경은 전체 active ID 집합과 catalog version이 맞을 때만 원자 반영한다", async () => {
    const categories = [
      category("a", { sortOrder: 0 }),
      category("b", { sortOrder: 1 }),
      category("c", { sortOrder: 2 }),
    ];
    const subject = createSubject({
      state: { categories, catalogVersion: 7 },
    });

    const result = await subject.reorder({
      commandKey: "reorder-cba",
      expectedCatalogVersion: 7,
      orderedCategoryIds: ["c", "b", "a"],
    });

    expect(result.kind).toBe("success");
    expect(
      subject
        .state()
        .categories.slice()
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map(({ categoryId }) => categoryId),
    ).toEqual(["c", "b", "a"]);

    const afterSuccess = subject.state();
    expect(
      await subject.reorder({
        commandKey: "reorder-invalid",
        expectedCatalogVersion: 7,
        orderedCategoryIds: ["a", "a", "c"],
      }),
    ).toEqual(expect.objectContaining({ kind: "conflict" }));
    expect(subject.state()).toEqual(afterSuccess);
  });

  it("[T-CAT-003][CAT-002] 공개 Command에는 archived 카테고리 재활성화와 hard delete가 없다", () => {
    expect(createSubject().publicCommands()).not.toEqual(
      expect.arrayContaining(["ReactivateCategory", "HardDeleteCategory"]),
    );
  });

  it("[T-CAT-004][CAT-003] 현재 기본 카테고리는 archive할 수 없다", async () => {
    const defaultCategory = category("default");
    const subject = createSubject({
      state: {
        categories: [defaultCategory],
        defaultCategoryId: "default",
      },
    });

    const result = await subject.archiveCategory({
      commandKey: "archive-default",
      categoryId: "default",
      expectedVersion: 1,
    });

    expect(result).toEqual({ kind: "conflict", code: "CATEGORY_IS_DEFAULT" });
    expect(subject.state().categories[0].state).toBe("active");
  });

  it("[T-CAT-004][CAT-002/CAT-003/REC-005] archive는 과거 거래를 유지하고 설정 참조만 기본 카테고리로 수렴시킨다", async () => {
    const subject = createSubject({
      state: {
        categories: [
          category("default", { sortOrder: 0 }),
          category("old", { sortOrder: 1 }),
        ],
        defaultCategoryId: "default",
        historicalTransactionCategoryIds: ["old"],
        recurringCategoryIds: ["old"],
        merchantRuleCategoryIds: ["old"],
      },
    });

    const accepted = await subject.archiveCategory({
      commandKey: "archive-old",
      categoryId: "old",
      expectedVersion: 1,
    });
    expect(accepted.kind).toBe("accepted");
    const completed =
      accepted.kind === "accepted"
        ? await subject.completeArchive(accepted.processId)
        : accepted;

    expect(completed.kind).toBe("success");
    expect(subject.state()).toMatchObject({
      historicalTransactionCategoryIds: ["old"],
      recurringCategoryIds: ["default"],
      merchantRuleCategoryIds: ["default"],
    });
    expect(
      subject.state().categories.find(({ categoryId }) => categoryId === "old")
        ?.state,
    ).toBe("archived");
  });

  it("[T-CAT-004][CAT-003] archived 카테고리는 새 기본값으로 다시 선택할 수 없다", async () => {
    const subject = createSubject({
      state: { categories: [category("old", { state: "archived" })] },
    });

    const result = await subject.setDefault({
      commandKey: "default-old",
      categoryId: "old",
    });

    expect(result).toEqual({
      kind: "conflict",
      code: "CATEGORY_NOT_USABLE",
    });
  });

  it("[T-CAT-004][CAT-003] active 카테고리를 기본값으로 바꾸면 Web 수동 등록도 같은 안정 ID를 사용한다", async () => {
    const subject = createSubject({
      state: {
        categories: [category("old-default"), category("new-default")],
        defaultCategoryId: "old-default",
      },
    });

    const result = await subject.setDefault({
      commandKey: "set-new-default",
      categoryId: "new-default",
    });

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({ categoryId: "new-default", state: "active" }),
    });
    expect(subject.state().defaultCategoryId).toBe("new-default");
    await expect(subject.defaultForManualEntry()).resolves.toEqual({
      kind: "success",
      value: expect.objectContaining({ categoryId: "new-default" }),
    });
  });

  it("[T-CAT-005][CAT-004] 활성 카테고리만 sortOrder와 안정 ID 순으로 제공한다", async () => {
    const subject = createSubject({
      state: {
        categories: [
          category("b", { sortOrder: 1 }),
          category("archived", { state: "archived", sortOrder: 0 }),
          category("a", { sortOrder: 1 }),
          category("first", { sortOrder: 0 }),
        ],
      },
    });

    const result = await subject.listActive();

    expect(result).toEqual({
      kind: "success",
      items: expect.arrayContaining([]),
    });
    if (result.kind === "success") {
      expect(result.items.map(({ categoryId }) => categoryId)).toEqual([
        "first",
        "a",
        "b",
      ]);
    }
  });

  it("[T-CAT-006][CAT-004] Repository 실패를 빈 카테고리나 기본 다섯 개로 위장하지 않는다", async () => {
    const result = await createSubject({ failList: true }).listActive();

    expect(result).toEqual({
      kind: "retryable-failure",
      code: "CATEGORY_REPOSITORY_UNAVAILABLE",
    });
  });

  it.each([
    { fixture: { state: { categories: [] } }, reason: "empty" },
    { fixture: { failList: true }, reason: "failure" },
  ])(
    "[T-CAT-005][CAT-004] legacy Android QuickEdit은 $reason을 구분하지 않고 표시 전용 기본 다섯 개로 fallback한다",
    async ({ fixture }) => {
      const items = await createSubject(fixture).legacyQuickEditCategories();

      expect(items.map(({ name }) => name)).toEqual([
        "생활비",
        "육아비",
        "고정비",
        "식비",
        "기타",
      ]);
      expect(createSubject(fixture).state().categories).toEqual([]);
    },
  );
});
