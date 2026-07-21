import { createTenantAuthorizationApplication } from "../../src/contexts/access/tenant-authorization/application/tenantAuthorizationApplication";
import { createCaptureAuthorizationApplication } from "../../src/contexts/payment-capture/android-payment-ingestion/application/captureAuthorizationApplication";
import type {
  CaptureApprovalCommitPort,
  CaptureApprovalConfigurationPort,
} from "../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureApprovalPorts";
import type {
  CaptureAuthorizationInputPort,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export type {
  CaptureAuthorizationInputPort,
  CaptureApprovalActor,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";

export interface CaptureAuthorizationState {
  readonly transactions: readonly {
    readonly transactionId: string;
    readonly householdId: string;
    readonly creatorMemberId: string;
  }[];
  readonly captureReceipts: readonly string[];
  readonly configurationResolutions: readonly string[];
}

class CaptureAuthorizationFixture
  implements CaptureApprovalConfigurationPort, CaptureApprovalCommitPort
{
  private nextTransactionSequence = 1;
  private readonly transactionRecords: {
    transactionId: string;
    householdId: string;
    creatorMemberId: string;
  }[] = [];
  private readonly receiptObservationIds: string[] = [];
  private readonly configurationObservationIds: string[] = [];

  async resolveForApproval(input: {
    readonly observationId: string;
  }): Promise<void> {
    this.configurationObservationIds.push(input.observationId);
  }

  async create(input: {
    readonly observationId: string;
    readonly householdId: string;
    readonly creatorMemberId: string;
  }): Promise<{ readonly transactionId: string }> {
    const transactionId = `transaction-${this.nextTransactionSequence}`;
    this.nextTransactionSequence += 1;
    this.transactionRecords.push({
      transactionId,
      householdId: input.householdId,
      creatorMemberId: input.creatorMemberId,
    });
    this.receiptObservationIds.push(input.observationId);
    return { transactionId };
  }

  state(): CaptureAuthorizationState {
    return {
      transactions: this.transactionRecords.map((transaction) => ({
        ...transaction,
      })),
      captureReceipts: [...this.receiptObservationIds],
      configurationResolutions: [...this.configurationObservationIds],
    };
  }
}

export interface CaptureAuthorizationDriver extends CaptureAuthorizationInputPort {
  state(): CaptureAuthorizationState;
}

export function createCaptureAuthorizationDriver(): CaptureAuthorizationDriver {
  const fixture = new CaptureAuthorizationFixture();
  const tenantAuthorization = createTenantAuthorizationApplication({
    memberships: {
      findByPrincipalUid: async () => undefined,
    },
  });
  const application = createCaptureAuthorizationApplication({
    tenantAuthorization,
    configuration: fixture,
    commits: fixture,
  });

  return {
    submitApproval: (input) => application.submitApproval(input),
    state: () => fixture.state(),
  };
}
