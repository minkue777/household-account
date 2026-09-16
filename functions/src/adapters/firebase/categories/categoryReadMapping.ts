import type { CategoryEntity } from "../../../contexts/household-finance/categories-budget/domain/model/categoryCatalog";

/** Canonical/legacy 저장 형식의 차이는 Category adapter에서만 해석합니다. */
export function categoryReferenceId(documentId: string, data: Readonly<Record<string, unknown>>): string {
  for (const field of ["categoryId", "key"]) {
    const value = data[field];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return documentId;
}

export function categoryLifecycleState(data: Readonly<Record<string, unknown>>): CategoryEntity["state"] {
  const state = [data.state, data.lifecycleState]
    .find((value): value is string => typeof value === "string" && value.trim() !== "")?.trim();
  if (state === "archive-pending" || state === "archived") return state;
  return data.isActive === false ? "archived" : "active";
}
