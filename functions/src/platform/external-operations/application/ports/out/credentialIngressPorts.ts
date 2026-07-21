import type { VerifiedIngressContext } from "../in/credentialIngressInputPort";

export interface CredentialIngressQuotaPort {
  credentialAvailable(credentialId: string): Promise<boolean>;
  sourceIpAvailable(sourceIp: string): Promise<boolean>;
}

export interface CredentialIngressReceiptPort {
  nextId(): string;
  save(input: { readonly receiptId: string; readonly context: VerifiedIngressContext }): Promise<void>;
}
