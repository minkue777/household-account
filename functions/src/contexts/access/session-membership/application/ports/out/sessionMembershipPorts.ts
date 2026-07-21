import type { SessionMembershipState } from "../../../domain/model/sessionMembership";
import type {
  SessionEndpointRegistrationResult,
  SessionEndpointRemovalResult,
  SessionScopeView,
} from "../in/sessionMembershipInputPort";

export interface SessionMembershipMutation<T> {
  state: SessionMembershipState;
  value: T;
}

export interface SessionMembershipStorePort {
  read(): Promise<SessionMembershipState>;
  transact<T>(
    operation: (
      state: SessionMembershipState,
    ) => SessionMembershipMutation<T>,
  ): Promise<T>;
}

export interface SessionEndpointPort {
  removeCurrentInstallationEndpoint(
    session: SessionScopeView,
  ): Promise<SessionEndpointRemovalResult>;
  registerCurrentInstallationEndpoint(
    session: SessionScopeView,
  ): Promise<SessionEndpointRegistrationResult>;
}
