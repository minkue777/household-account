import type {
  ProtectedIngress,
  ProtectedIngressResult,
  VerifiedIngressPrincipal,
} from "../../../domain/model/protectedIngress";

export interface IngressCredentialVerificationPort {
  verify(
    authorization: string,
  ): Promise<VerifiedIngressPrincipal | undefined>;
}

export interface AppAttestationVerificationPort {
  verify(appAttestation: string): Promise<boolean>;
}

export interface AuthorizedIngressDispatcherPort {
  dispatch(input: {
    entryPoint: ProtectedIngress;
    principal: VerifiedIngressPrincipal;
    payload: Readonly<Record<string, unknown>>;
  }): Promise<Extract<ProtectedIngressResult, { kind: "success" }>>;
}
