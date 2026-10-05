import type * as firestore from "firebase-admin/firestore";

import {
  FirebaseMobileEndpointRegistrationStore,
  Sha256MobileEndpointIdentityAdapter,
} from "../../adapters/firebase/notifications/firebaseMobileEndpointRegistrationStore";
import { createMobileEndpointCommands } from "../../contexts/notifications/application/mobileEndpointCommands";
import type { MobileEndpointDeviceInfo } from "../../contexts/notifications/domain/model/mobileNotificationEndpoint";
import {
  HouseholdCommandRejection,
  type HouseholdCommandExecutionContext,
  type HouseholdCommandHandler,
} from "./householdCommand";

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HouseholdCommandRejection("INVALID_PAYLOAD");
  }
  return value as Record<string, unknown>;
}

function requiredString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new HouseholdCommandRejection(`${field.toUpperCase()}_REQUIRED`);
  }
  return value.trim();
}

function deviceInfo(value: unknown): MobileEndpointDeviceInfo {
  if (value === undefined) return {};
  const input = record(value);
  const allowed = new Set(["model", "osVersion", "sdkVersion", "appVersion"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new HouseholdCommandRejection("DEVICE_INFO_INVALID");
  }
  const result: Record<string, string> = {};
  for (const field of allowed) {
    const candidate = input[field];
    if (candidate === undefined) continue;
    if (typeof candidate !== "string" || candidate.length > 160) {
      throw new HouseholdCommandRejection("DEVICE_INFO_INVALID");
    }
    result[field] = candidate;
  }
  return result;
}

function commandsFor(
  database: firestore.Firestore,
  context: HouseholdCommandExecutionContext,
) {
  if (context.actor === undefined) {
    throw new HouseholdCommandRejection("HOUSEHOLD_FORBIDDEN");
  }
  return createMobileEndpointCommands(
    new FirebaseMobileEndpointRegistrationStore(database),
    new Sha256MobileEndpointIdentityAdapter(),
    { now: () => context.requestedAt },
    { householdId: context.actor.householdId, memberId: context.actor.actingMemberId },
  );
}

function resultValue(result: Awaited<ReturnType<ReturnType<typeof commandsFor>["register"]>>) {
  if (result.kind === "validation-error") throw new HouseholdCommandRejection(result.code);
  return result;
}

export function createNotificationHouseholdCommandHandlers(
  database: firestore.Firestore,
): ReadonlyMap<string, HouseholdCommandHandler> {
  return new Map<string, HouseholdCommandHandler>([
    [
      "notifications.register-endpoint.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          const allowed = new Set(["fid", "platform", "deviceInfo"]);
          if (Object.keys(payload).some((key) => !allowed.has(key))) {
            throw new HouseholdCommandRejection("INVALID_PAYLOAD");
          }
          const platform = requiredString(payload, "platform");
          if (platform !== "android" && platform !== "ios-pwa") {
            throw new HouseholdCommandRejection("PLATFORM_NOT_SUPPORTED");
          }
          const result = await commandsFor(database, context).register({
            platform,
            fid: requiredString(payload, "fid"),
            deviceInfo: deviceInfo(payload.deviceInfo),
          });
          return resultValue(result);
        },
      },
    ],
    [
      "notifications.remove-endpoint.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          const allowed = new Set(["fid", "reason", "expectedRegistrationVersion"]);
          if (Object.keys(payload).some((key) => !allowed.has(key))) {
            throw new HouseholdCommandRejection("INVALID_PAYLOAD");
          }
          const fid = requiredString(payload, "fid");
          const reason = requiredString(payload, "reason");
          const commands = commandsFor(database, context);
          if (reason === "logout") {
            return resultValue(await commands.logout(fid));
          }
          if (reason !== "sdk-unregistered") {
            throw new HouseholdCommandRejection("REMOVAL_REASON_INVALID");
          }
          if (
            typeof payload.expectedRegistrationVersion !== "number" ||
            !Number.isSafeInteger(payload.expectedRegistrationVersion) ||
            payload.expectedRegistrationVersion < 1
          ) {
            throw new HouseholdCommandRejection(
              "EXPECTED_REGISTRATION_VERSION_REQUIRED",
            );
          }
          return resultValue(
            await commands.unregister({
              fid,
              expectedRegistrationVersion: payload.expectedRegistrationVersion,
            }),
          );
        },
      },
    ],
  ]);
}
