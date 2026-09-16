export const FIREBASE_TARGETS: readonly string[];
export function firebaseTargetsForPaths(paths: readonly string[]): string[];
export interface QueryDeployment { releaseId: string; commitSha: string; artifactSha256: string }
export interface FirebaseDeploymentScope { baseReleaseId: string | null; baseCommitSha: string | null; targets: string[]; queryDeployment?: QueryDeployment }
export function planFirebaseDeployment(input: {
  head: string;
  previous?: { record: { status: string; smoke: { status: string }; commitSha: string; releaseId: string; artifact: { sha256: string } }; scope?: FirebaseDeploymentScope };
  manifest?: { releaseId: string; artifacts: Array<{ sha256: string }> };
  deployAll?: boolean;
}, git?: (args: string[]) => string): FirebaseDeploymentScope;
export function readFirebaseDeploymentBaseline(database: unknown): Promise<unknown>;
export function requireFirebaseDeploymentScope(approved: unknown, current: FirebaseDeploymentScope, only: string | undefined): void;
