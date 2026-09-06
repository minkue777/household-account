import type { GateEvidence, TestRunSummary } from '../src/platform/delivery-assurance/application/ports/in/releaseCandidateEvaluationInputPort';
export function assertionSummary(report: unknown, filter?: (name: string) => boolean): TestRunSummary;
export function androidSummary(directory: string): TestRunSummary;
export function releaseGateEvidence(functionsReport: unknown, webReport: unknown, androidReport: TestRunSummary): GateEvidence[];
export function requireSuccessfulHeadRun(runs: readonly unknown[], sha: string, jobs: readonly unknown[]): unknown;
