export interface RequirementDeclaration { id: string; status: string; row: string; }
export function parseRequirementTable(source: string): RequirementDeclaration[];
export function readDeclarations(root: string): {
  markdown: string[];
  sources: string[];
  requirements: Array<RequirementDeclaration & { file: string }>;
  tests: Map<string, string>;
};
