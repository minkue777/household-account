import type { TenantAuthorizationInputPort } from "../../../access/public";
import type {
  CaptureAuthorizationInputPort,
  CaptureAuthorizationResult,
  SubmitCaptureApprovalInput,
} from "./ports/in/captureAuthorizationInputPort";
import type {
  CaptureApprovalCommitPort,
  CaptureApprovalConfigurationPort,
} from "./ports/out/captureApprovalPorts";
import { authorizeCaptureSubmission } from "./captureSubmissionAuthorization";

export interface CaptureAuthorizationDependencies {
  readonly tenantAuthorization: TenantAuthorizationInputPort;
  readonly configuration: CaptureApprovalConfigurationPort;
  readonly commits: CaptureApprovalCommitPort;
}

class DefaultCaptureAuthorizationApplication
  implements CaptureAuthorizationInputPort
{
  constructor(private readonly dependencies: CaptureAuthorizationDependencies) {}

  async submitApproval(
    input: SubmitCaptureApprovalInput,
  ): Promise<CaptureAuthorizationResult> {
    const authorization = authorizeCaptureSubmission({
      tenantAuthorization: this.dependencies.tenantAuthorization,
      actor: input.actor,
      envelopeHouseholdId: input.envelopeHouseholdId,
    });
    if (authorization.kind !== "Authorized") return authorization;

    await this.dependencies.configuration.resolveForApproval({
      observationId: input.observationId,
      householdId: authorization.householdId,
      ownerMemberId: authorization.creatorMemberId,
    });
    const committed = await this.dependencies.commits.create({
      observationId: input.observationId,
      householdId: authorization.householdId,
      creatorMemberId: authorization.creatorMemberId,
    });

    return {
      kind: "Created",
      transactionId: committed.transactionId,
      householdId: authorization.householdId,
      creatorMemberId: authorization.creatorMemberId,
    };
  }
}

export function createCaptureAuthorizationApplication(
  dependencies: CaptureAuthorizationDependencies,
): CaptureAuthorizationInputPort {
  return new DefaultCaptureAuthorizationApplication(dependencies);
}
