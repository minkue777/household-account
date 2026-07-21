import type { PwaBootstrapResult } from "../domain/model/pwaInstallMetadata";
import { validatePwaInstallMetadataPolicy } from "../domain/policies/pwaInstallMetadataPolicy";
import type { PwaInstallMetadataInputPort } from "./ports/in/pwaInstallMetadataInputPort";
import type { PwaRootRuntimeInputPort } from "./ports/in/pwaRootRuntimeInputPort";

export function createPwaInstallMetadataApplication(dependencies: {
  readonly rootRuntime: PwaRootRuntimeInputPort;
}): PwaInstallMetadataInputPort {
  return {
    async bootstrap(input): Promise<PwaBootstrapResult> {
      if (input.environment === "development") {
        await dependencies.rootRuntime.initialize({
          environment: "development",
          displayMode: "browser",
          deviceClass: "desktop",
        });
        return {
          kind: "DisabledForDevelopment",
          workerRegistrations: [],
        };
      }

      const configurationFailure = validatePwaInstallMetadataPolicy(
        input.manifest,
      );
      if (configurationFailure !== undefined) {
        return {
          kind: "ConfigurationRejected",
          code: configurationFailure,
          workerRegistrations: [],
        };
      }

      const runtimeResult = await dependencies.rootRuntime.initialize({
        environment: "production",
        displayMode: "browser",
        deviceClass: "desktop",
      });

      if (runtimeResult.kind === "Failed") {
        return {
          kind: "ConfigurationRejected",
          code: "ROOT_WORKER_UNAVAILABLE",
          workerRegistrations: [],
        };
      }

      const registrations = dependencies.rootRuntime.state().registrations;
      if (
        registrations.length !== 1 ||
        registrations[0]?.scope !== "/" ||
        registrations[0]?.scriptUrl !== "/sw.js"
      ) {
        return {
          kind: "ConfigurationRejected",
          code: "ROOT_WORKER_UNAVAILABLE",
          workerRegistrations: [],
        };
      }

      return {
        kind: "Enabled",
        workerRegistrations: [{ scope: "/", scriptUrl: "/sw.js" }],
        installability: "installable",
        display: "standalone",
        orientation: "portrait",
      };
    },
  };
}
