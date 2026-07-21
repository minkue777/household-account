import type {
  GateEvidence,
  ReleaseCandidateManifest,
} from "../in/releaseCandidateEvaluationInputPort";

export interface ReleaseGateEvidencePort {
  collect(): Promise<readonly GateEvidence[]>;
}

export interface ReleaseManifestHashPort {
  hash(manifest: ReleaseCandidateManifest): string;
}
