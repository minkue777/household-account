import { describe, expect, it } from "vitest";
import { createTrendCategorySelection } from "../../../../src/read-side/reporting/public";

interface CategoryFixture {
  categoryId: string;
  active: boolean;
  budgetOrder?: number;
}

interface TrendCategoryFixture {
  categories: readonly CategoryFixture[];
  compatibilityDefaults: readonly string[];
}

export interface TrendCategorySelectionSubject {
  initialSelection(): readonly string[];
  toggle(categoryId: string): readonly string[];
  reload(): readonly string[];
}

export function createSubject(
  fixture: TrendCategoryFixture,
): TrendCategorySelectionSubject {
  return createTrendCategorySelection(fixture);
}

describe("Reporting 추이 카테고리 선택 계약", () => {
  it("[T-STAT-004][STAT-003] 예산이 설정된 활성 카테고리를 예산 순서로 결정한다", () => {
    const subject = createSubject({
      categories: [
        { categoryId: "food", active: true, budgetOrder: 2 },
        { categoryId: "childcare", active: true, budgetOrder: 1 },
        { categoryId: "inactive-budget", active: false, budgetOrder: 0 },
        { categoryId: "no-budget", active: true },
      ],
      compatibilityDefaults: ["living", "childcare", "food"],
    });

    expect(subject.initialSelection()).toEqual(["childcare", "food"]);
  });

  it("[T-STAT-004][STAT-003] 활성 예산 카테고리가 없으면 존재하는 호환 기본 카테고리만 고정 순서로 사용한다", () => {
    const subject = createSubject({
      categories: [
        { categoryId: "food", active: true },
        { categoryId: "childcare", active: false },
        { categoryId: "living", active: true },
      ],
      compatibilityDefaults: ["living", "childcare", "food"],
    });

    expect(subject.initialSelection()).toEqual(["living", "food"]);
  });

  it("[T-STAT-004][STAT-003] 사용자 토글은 현재 화면에만 반영되고 재조회 초기값으로 저장되지 않는다", () => {
    const subject = createSubject({
      categories: [
        { categoryId: "food", active: true, budgetOrder: 1 },
        { categoryId: "transport", active: true },
      ],
      compatibilityDefaults: ["food"],
    });

    expect(subject.toggle("transport")).toEqual(["food", "transport"]);
    expect(subject.reload()).toEqual(["food"]);
  });
});
