import type {
  CompatibilityPlan,
  DeploymentTargetCompatibilityInputPort,
  DeploymentTargetCandidate,
} from "./ports/in/deploymentTargetCompatibilityInputPort";

const PROJECT_ID = "household-account-6f300" as const;
const REQUIRED_RESOURCES: readonly DeploymentTargetCandidate["bindings"][number]["resource"][] = [
  "firebase-api",
  "rules",
  "indexes",
  "secret",
  "monitoring-channel",
];

function hasExactlyRequiredBindings(candidate: DeploymentTargetCandidate): boolean {
  return (
    candidate.bindings.length === REQUIRED_RESOURCES.length &&
    REQUIRED_RESOURCES.every(
      (resource) => candidate.bindings.filter((binding) => binding.resource === resource).length === 1,
    )
  );
}

function validWindow(plan: CompatibilityPlan): boolean {
  const { window } = plan;
  return (
    window.oldContractVersion.length > 0 &&
    window.newContractVersion.length > 0 &&
    window.oldContractVersion !== window.newContractVersion &&
    Date.parse(window.startsAt) < Date.parse(window.endsAt) &&
    Object.keys(window.minimumSupportedClients).length > 0 &&
    Object.values(window.minimumSupportedClients).every((value) => value.length > 0)
  );
}

function capabilityIndex(plan: CompatibilityPlan, capability: string): number {
  return plan.steps.findIndex((step) => step.capabilities.includes(capability));
}

function validSteps(plan: CompatibilityPlan): boolean {
  if (
    plan.steps.length === 0 ||
    plan.steps.some(
      ({ rollbackCheckpoint }) =>
        rollbackCheckpoint === undefined || rollbackCheckpoint.trim().length === 0,
    )
  ) {
    return false;
  }
  const ranks = { expand: 0, migrate: 1, contract: 2 } as const;
  const phaseRanks = plan.steps.map(({ phase }) => ranks[phase]);
  if (
    !phaseRanks.includes(0) ||
    !phaseRanks.includes(1) ||
    !phaseRanks.includes(2) ||
    phaseRanks.some((rank, index) => index > 0 && rank < phaseRanks[index - 1])
  ) {
    return false;
  }

  if (plan.change === "fid-token-to-fid") {
    const registration = capabilityIndex(plan, "fid-client-registration");
    const dualRead = capabilityIndex(plan, "fid-endpoint-dual-read");
    const sender = capabilityIndex(plan, "fid-admin-sender");
    const observed = capabilityIndex(plan, "fid-registration-observed");
    const removal = capabilityIndex(plan, "legacy-token-reader-writer-removed");
    return (
      registration >= 0 &&
      dualRead >= 0 &&
      sender > registration &&
      sender > dualRead &&
      observed > sender &&
      removal > observed
    );
  }

  if (plan.change === "legacy-membership-to-claims") {
    const blocked = capabilityIndex(plan, "direct-public-rules-blocked");
    if (blocked < 0) return true;
    const prerequisites = [
      "claim-compatible-client",
      "claim-compatible-rules",
      "membership-claim-observed",
      "server-command-read",
    ].map((capability) => capabilityIndex(plan, capability));
    return prerequisites.every((index) => index >= 0 && index < blocked);
  }

  return true;
}

export function createDeploymentTargetCompatibilityApplication(): DeploymentTargetCompatibilityInputPort {
  return {
    async resolveDeploymentTarget(candidate) {
      if (!hasExactlyRequiredBindings(candidate)) {
        return { kind: "rejected", code: "TARGET_MISMATCH" };
      }
      if (candidate.environment === "production") {
        const matches =
          candidate.explicitProjectId === PROJECT_ID &&
          candidate.bindings.every(
            ({ resource, target }) =>
              target.kind === "cloud-project" &&
              target.projectId === PROJECT_ID &&
              (resource !== "firebase-api" ||
                target.httpsOrigin === `https://${PROJECT_ID}.web.app`),
          );
        return matches
          ? {
              kind: "resolved",
              target: { environment: "production", mode: "cloud-project", projectId: PROJECT_ID },
            }
          : { kind: "rejected", code: "TARGET_MISMATCH" };
      }

      if (candidate.bindings.some(({ target }) => target.kind !== "emulator")) {
        return { kind: "rejected", code: "TARGET_MISMATCH" };
      }
      return {
        kind: "resolved",
        target: {
          environment: candidate.environment,
          mode: "emulator",
          authorities: [
            ...new Set(
              candidate.bindings.map(({ target }) =>
                target.kind === "emulator" ? target.authority : "",
              ),
            ),
          ],
        },
      };
    },

    async verifyCompatibilityWindow(manifest) {
      const changes = [...manifest.sharedContractChanges];
      const plans = [...(manifest.compatibilityPlans ?? [])];
      const uniqueChanges = new Set(changes);
      const valid =
        uniqueChanges.size === changes.length &&
        plans.length === changes.length &&
        changes.every(
          (change) => plans.filter((candidate) => candidate.change === change).length === 1,
        ) &&
        plans.every((candidate) => uniqueChanges.has(candidate.change)) &&
        plans.every((candidate) => validWindow(candidate) && validSteps(candidate));
      if (!valid) return { kind: "rejected", code: "INCOMPATIBLE_ORDER" };

      const orderedPlans = changes.map(
        (change) => plans.find((candidate) => candidate.change === change)!,
      );
      return {
        kind: "compatible",
        windows: orderedPlans.map(({ window }) => window),
        rollbackCheckpoints: orderedPlans.flatMap(({ steps }) =>
          steps.map(({ rollbackCheckpoint }) => rollbackCheckpoint!),
        ),
      };
    },
  };
}
