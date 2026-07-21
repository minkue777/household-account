import type {
  LogoutSessionResult,
  RestoreSessionResult,
  SessionMembershipInputPort,
  VerifiedSessionPrincipal,
} from "./ports/in/sessionMembershipInputPort";
import type {
  SessionEndpointPort,
  SessionMembershipStorePort,
} from "./ports/out/sessionMembershipPorts";
import {
  isCurrentSessionGeneration,
  resolveRetainedMembership,
  SUPPORTED_USER_ACCESS_COMMANDS,
} from "../domain/policies/sessionMembershipPolicy";

export interface SessionMembershipApplicationDependencies {
  store: SessionMembershipStorePort;
  endpoints: SessionEndpointPort;
}

class DefaultSessionMembershipApplication
  implements SessionMembershipInputPort
{
  constructor(
    private readonly dependencies: SessionMembershipApplicationDependencies,
  ) {}

  supportedAccessCommands(): readonly string[] {
    return SUPPORTED_USER_ACCESS_COMMANDS;
  }

  async logoutHouseholdSession(): Promise<LogoutSessionResult> {
    const before = await this.dependencies.store.read();
    if (before.session === undefined) {
      return { kind: "logged-out", endpoint: "already-absent" };
    }

    const endpointResult =
      await this.dependencies.endpoints.removeCurrentInstallationEndpoint(
        before.session,
      );
    if (endpointResult.kind === "retryable-failure") {
      return endpointResult;
    }

    return this.dependencies.store.transact<LogoutSessionResult>((state) => {
      if (
        !isCurrentSessionGeneration(
          state,
          before.session?.sessionGeneration ?? -1,
        )
      ) {
        return {
          state,
          value: { kind: "retryable-failure", code: "SESSION_CHANGED" },
        };
      }

      return {
        state: {
          ...state,
          session: undefined,
          bridgeMirror: undefined,
          notificationSync: "not-requested",
        },
        value: {
          kind: "logged-out",
          endpoint: endpointResult.kind,
        },
      };
    });
  }

  async restoreSignedInSession(
    principal: VerifiedSessionPrincipal,
  ): Promise<RestoreSessionResult> {
    const { principalUid } = principal;
    const before = await this.dependencies.store.read();
    if (before.household.lifecycleState !== "active") {
      return { kind: "conflict", code: "HOUSEHOLD_NOT_ACTIVE" };
    }
    if (before.membership.principalUid !== principalUid) {
      return { kind: "unauthenticated", code: "MEMBERSHIP_REQUIRED" };
    }

    const restored = await this.dependencies.store.transact<
      | { kind: "restored-locally"; session: NonNullable<typeof before.session> }
      | { kind: "conflict"; code: "HOUSEHOLD_NOT_ACTIVE" }
      | { kind: "unauthenticated"; code: string }
    >((state) => {
      if (state.household.lifecycleState !== "active") {
        return {
          state,
          value: { kind: "conflict", code: "HOUSEHOLD_NOT_ACTIVE" },
        };
      }
      if (state.membership.principalUid !== principalUid) {
        return {
          state,
          value: { kind: "unauthenticated", code: "MEMBERSHIP_REQUIRED" },
        };
      }
      const resolved = resolveRetainedMembership(state, principalUid);
      if (resolved === undefined) {
        return {
          state,
          value: { kind: "unauthenticated", code: "MEMBERSHIP_REQUIRED" },
        };
      }
      return {
        state: {
          ...state,
          session: resolved.session,
          bridgeMirror: resolved.bridgeMirror,
          lastSessionGeneration: resolved.generation,
          notificationSync: "not-requested",
        },
        value: { kind: "restored-locally", session: resolved.session },
      };
    });

    if (restored.kind !== "restored-locally") {
      return restored;
    }

    const notificationSync =
      await this.dependencies.endpoints.registerCurrentInstallationEndpoint(
        restored.session,
      );
    await this.dependencies.store.transact<void>((state) => ({
      state: isCurrentSessionGeneration(
        state,
        restored.session.sessionGeneration,
      )
        ? {
            ...state,
            notificationSync:
              notificationSync.kind === "registered"
                ? "registered"
                : "retryable-failure",
          }
        : state,
      value: undefined,
    }));

    return {
      kind: "restored",
      session: restored.session,
      notificationSync,
    };
  }
}

export function createSessionMembershipApplication(
  dependencies: SessionMembershipApplicationDependencies,
): SessionMembershipInputPort {
  return new DefaultSessionMembershipApplication(dependencies);
}
