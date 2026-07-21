import type {
  ProtectedIngress,
  ProtectedIngressRequest,
  ProtectedIngressResult,
} from "../../../domain/model/protectedIngress";

export type { ProtectedIngress, ProtectedIngressRequest, ProtectedIngressResult };

export interface ProtectedIngressInputPort {
  supportedPublicIngresses(): readonly ProtectedIngress[];
  invoke(input: ProtectedIngressRequest): Promise<ProtectedIngressResult>;
}
