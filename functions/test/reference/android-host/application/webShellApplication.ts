import type {
  WebShellEnvironment,
  WebShellInitializationResult,
  WebShellInputPort,
} from "./ports/in/webShellInputPort";

function validateNavigationUrl(
  rawUrl: string,
  environment: WebShellEnvironment,
): WebShellInitializationResult | undefined {
  let navigation: URL;
  let allowedOrigin: URL;

  try {
    navigation = new URL(rawUrl);
    allowedOrigin = new URL(environment.allowedOrigin);
  } catch {
    return { kind: "BuildRejected", code: "ORIGIN_MISMATCH" };
  }

  if (navigation.protocol !== "https:") {
    return { kind: "BuildRejected", code: "INSECURE_START_URL" };
  }

  if (
    allowedOrigin.protocol !== "https:" ||
    allowedOrigin.origin !== environment.allowedOrigin ||
    navigation.origin !== allowedOrigin.origin
  ) {
    return { kind: "BuildRejected", code: "ORIGIN_MISMATCH" };
  }

  return undefined;
}

export function createWebShellApplication(): WebShellInputPort {
  return {
    initialize({ environment, restoredNavigationUrl }) {
      if (
        environment.environment !== "production" &&
        environment.environment !== "development"
      ) {
        return { kind: "BuildRejected", code: "UNKNOWN_ENVIRONMENT" };
      }

      const startUrlFailure = validateNavigationUrl(
        environment.startUrl,
        environment,
      );
      if (startUrlFailure !== undefined) return startUrlFailure;

      if (restoredNavigationUrl !== undefined) {
        const restoredUrlFailure = validateNavigationUrl(
          restoredNavigationUrl,
          environment,
        );
        if (restoredUrlFailure !== undefined) return restoredUrlFailure;
        return {
          kind: "RestoredWithoutReload",
          url: restoredNavigationUrl,
          loadCount: 0,
        };
      }

      return { kind: "Loaded", url: environment.startUrl, loadCount: 1 };
    },

    onBack({ screen, webViewCanGoBack }) {
      return screen === "web-shell" && webViewCanGoBack
        ? { kind: "WebHistoryNavigated" }
        : { kind: "ActivityDelegated" };
    },

    presentVersion({ versionName, packageLookupSucceeded }) {
      if (!packageLookupSucceeded || versionName?.trim() === "") {
        return { kind: "Unknown", value: "앱 버전 알 수 없음" };
      }
      return versionName === undefined
        ? { kind: "Unknown", value: "앱 버전 알 수 없음" }
        : { kind: "Known", value: `앱 버전 ${versionName}` };
    },
  };
}
