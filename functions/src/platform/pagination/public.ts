export function pageItems<T>(items: readonly T[], pageSize: number): T[][] {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error("pageSize는 양의 정수여야 합니다.");
  }
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += pageSize) {
    pages.push(items.slice(index, index + pageSize));
  }
  return pages;
}
