import type { ReleaseEvaluation } from '../src/platform/delivery-assurance/application/ports/in/releaseCandidateEvaluationInputPort';
export function verifyCandidate(manifest: unknown, projectId: unknown, dependencies: unknown): Promise<ReleaseEvaluation>;
export function currentHashes(workspaceRoot?: string): { artifact: { name: string; sha256: string }; dependencyLockHash: string; contractHash: string; rulesHash: string; indexesHash: string };
export function writeDeploymentMarker(manifest: unknown, artifact: unknown, workspaceRoot?: string): void;
export function requireAuthorizedActor(manifest: unknown, actorId: string): void;
export function requireSmokeMarker(response: unknown, manifest: unknown, artifact: unknown): void;
export function verifyCloudResource(credential: { getAccessToken(): Promise<{ access_token: string }> }, resource: string, api: string): Promise<boolean>;
