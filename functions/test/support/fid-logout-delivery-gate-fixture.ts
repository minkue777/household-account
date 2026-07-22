export type CleanupOutcome = "succeeded" | "failed" | "timed-out";

export interface FidBindingFixture {
  householdId: string;
  memberId: string;
  registrationVersion: number;
}

export interface LogoutFixtureInput {
  componentDisableSucceeds: boolean;
  suppression: CleanupOutcome;
  remoteRemoval: CleanupOutcome;
  localUnregistration: CleanupOutcome;
}

export interface LogoutFixtureResult {
  loggedOut: boolean;
  componentBlocked: boolean;
  notificationsCancelled: boolean;
  suppression: CleanupOutcome;
  remoteRemoval: CleanupOutcome;
  localUnregistration: CleanupOutcome;
  events: readonly string[];
}

export interface RegistrationFixtureResult {
  started: boolean;
  events: readonly string[];
}

export class FidLogoutDeliveryGateFixture {
  private componentEnabled = true;
  private suppressed = false;
  private session: { householdId: string; memberId: string } | null;
  private binding: FidBindingFixture | null;

  constructor(binding: FidBindingFixture | null = null) {
    this.binding = binding;
    this.session = binding
      ? { householdId: binding.householdId, memberId: binding.memberId }
      : null;
  }

  logout(input: LogoutFixtureInput): LogoutFixtureResult {
    const events = ["component-disable-attempt", "notification-cancel-attempt"];
    if (input.componentDisableSucceeds) this.componentEnabled = false;

    events.push("suppression-persist-attempt");
    if (input.suppression === "succeeded") this.suppressed = true;

    // Both starts are observable before either bounded cleanup outcome is joined.
    events.push("remote-remove-start", "local-unregister-start");
    if (input.remoteRemoval === "succeeded") this.binding = null;
    if (input.localUnregistration === "succeeded") this.binding = null;
    this.session = null;

    return {
      loggedOut: true,
      componentBlocked: !this.componentEnabled,
      notificationsCancelled: input.componentDisableSucceeds,
      suppression: input.suppression,
      remoteRemoval: input.remoteRemoval,
      localUnregistration: input.localUnregistration,
      events,
    };
  }

  startWithoutSession(): void {
    if (this.session === null) this.componentEnabled = false;
  }

  login(
    householdId: string,
    memberId: string,
    staleUnregistration: CleanupOutcome,
  ): RegistrationFixtureResult {
    const events: string[] = [];
    this.session = { householdId, memberId };
    const staleCleanupRequired =
      this.suppressed ||
      (this.binding !== null &&
        (this.binding.householdId !== householdId ||
          this.binding.memberId !== memberId));

    if (staleCleanupRequired) {
      events.push("stale-unregister-start");
      if (staleUnregistration !== "succeeded") {
        this.componentEnabled = false;
        return { started: false, events };
      }
      this.binding = null;
    }

    events.push("component-enable", "registration-start");
    this.componentEnabled = true;
    return { started: true, events };
  }

  confirm(binding: FidBindingFixture): void {
    this.binding = binding;
    this.suppressed = false;
  }

  canDisplay(): boolean {
    return (
      this.componentEnabled &&
      !this.suppressed &&
      this.session !== null &&
      this.binding !== null &&
      this.binding.registrationVersion > 0 &&
      this.session.householdId === this.binding.householdId &&
      this.session.memberId === this.binding.memberId
    );
  }
}
