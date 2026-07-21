import type {
  GateEvidence,
  ReleaseCandidateEvaluationInputPort,
  RequiredReleaseGate,
} from "./ports/in/releaseCandidateEvaluationInputPort";
import type {
  ReleaseGateEvidencePort,
  ReleaseManifestHashPort,
} from "./ports/out/releaseCandidateEvaluationPorts";

const REQUIRED_GATES: readonly RequiredReleaseGate[] = [
  "web-build",
  "functions-build",
  "android-build",
  "active-unit-tests",
  "active-contract-tests",
  "firestore-rules-emulator",
  "requirement-id-trace",
  "relative-link-check",
  "architecture-fitness",
];

function normalizedEvidence(
  gate: RequiredReleaseGate,
  evidence: GateEvidence | undefined,
): GateEvidence {
  if (evidence === undefined) return { gate, status: "missing" };
  if (evidence.status !== "passed") return evidence;
  if (gate !== "active-unit-tests" && gate !== "active-contract-tests") {
    return evidence;
  }
  const run = evidence.testRun;
  const invalid =
    run === undefined ||
    run.active < 0 ||
    run.passed !== run.active ||
    run.failed !== 0 ||
    run.skipped !== 0 ||
    run.knownFailures !== 0;
  return invalid ? { ...evidence, status: "failed" } : evidence;
}

export function createReleaseCandidateEvaluationApplication(dependencies: {
  readonly evidence: ReleaseGateEvidencePort;
  readonly manifestHash: ReleaseManifestHashPort;
}): ReleaseCandidateEvaluationInputPort {
  return {
    async evaluate(manifest) {
      const collected = await dependencies.evidence.collect();
      const results = REQUIRED_GATES.map((gate) =>
        normalizedEvidence(gate, collected.find((item) => item.gate === gate)),
      );
      const failed = results.flatMap((evidence) => {
        if (evidence.status === "passed") return [];
        return [
          {
            gate: evidence.gate,
            code: evidence.status === "missing" ? ("GATE_MISSING" as const) : ("GATE_FAILED" as const),
            observedStatus: evidence.status,
          },
        ];
      });
      if (failed.length > 0) {
        return {
          kind: "rejected",
          gateResults: results,
          failed,
          waivers: [...(manifest.waivers ?? [])],
        };
      }
      return {
        kind: "approved",
        gateResults: results,
        deployAuthorization: {
          releaseId: manifest.releaseId,
          manifestHash: dependencies.manifestHash.hash(manifest),
        },
      };
    },
  };
}
