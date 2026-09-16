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
  const state = [data.state, data.lifecycleState, data.lifecycle]
    .find((value): value is string => typeof value === "string" && value.trim() !== "")?.trim();
  if (state === "archive-pending" || state === "archived") return state;
  if (state === "deleted") return "archived";
  return data.isActive === false ? "archived" : "active";
}

interface CategoryReferenceDocument {
  readonly id: string;
  data(): Readonly<Record<string, unknown>>;
}

/** 같은 업무 ID의 legacy 별칭까지 canonical 상태를 따르게 합니다. */
export function mergeActiveCategoryReferences(input: {
  readonly legacy: readonly CategoryReferenceDocument[];
  readonly canonical: readonly CategoryReferenceDocument[];
}): readonly { readonly categoryId: string; readonly documentIds: readonly string[] }[] {
  const references = new Map<string, { active: boolean; documentIds: Set<string> }>();
  for (const snapshot of [...input.legacy, ...input.canonical]) {
    const data = snapshot.data();
    const categoryId = categoryReferenceId(snapshot.id, data);
    const documentIds = references.get(categoryId)?.documentIds ?? new Set<string>();
    documentIds.add(snapshot.id);
    references.set(categoryId, {
      active: categoryLifecycleState(data) === "active",
      documentIds,
    });
  }
  return [...references].flatMap(([categoryId, reference]) => reference.active
    ? [{ categoryId, documentIds: [...reference.documentIds] }]
    : []);
}
