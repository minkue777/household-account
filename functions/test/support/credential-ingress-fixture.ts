import { createCredentialIngressApplication } from "../../src/platform/external-operations/application/credentialIngressApplication";
import type { VerifiedIngressContext } from "../../src/platform/external-operations/public";

export function createCredentialIngressFixture(fixture: {
  readonly allowedOrigins: readonly string[];
  readonly supportedAppIds: readonly string[];
  readonly exhaustedCredentialIds?: readonly string[];
  readonly exhaustedSourceIps?: readonly string[];
}) {
  const receipts: { receiptId: string; context: VerifiedIngressContext }[] = [];
  let sequence = 0;
  const application = createCredentialIngressApplication({
    allowedOrigins: fixture.allowedOrigins,
    supportedAppIds: fixture.supportedAppIds,
    quota: {
      credentialAvailable: async (id) =>
        !(fixture.exhaustedCredentialIds ?? []).includes(id),
      sourceIpAvailable: async (ip) =>
        !(fixture.exhaustedSourceIps ?? []).includes(ip),
    },
    receipts: {
      nextId: () => `application-receipt-${++sequence}`,
      async save(receipt) {
        receipts.push(receipt);
      },
    },
  });
  return {
    ...application,
    applicationReceipts: () => receipts.map((receipt) => ({ ...receipt })),
  };
}
