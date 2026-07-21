import type {
  PwaInstallMetadataFailureCode,
  PwaManifestMetadata,
} from "../model/pwaInstallMetadata";

const requiredInstallIconSizes = ["192x192", "512x512"] as const;

function hasInstallName(manifest: PwaManifestMetadata): boolean {
  return [manifest.name, manifest.shortName].some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

function iconDeclaresSize(sizes: string, requiredSize: string): boolean {
  return sizes
    .trim()
    .split(/\s+/)
    .some((size) => size.toLowerCase() === requiredSize);
}

function hasRequiredInstallIcons(manifest: PwaManifestMetadata): boolean {
  return requiredInstallIconSizes.every((requiredSize) =>
    manifest.icons.some(
      (icon) =>
        icon.src.trim().startsWith("/") &&
        !icon.src.trim().startsWith("//") &&
        iconDeclaresSize(icon.sizes, requiredSize),
    ),
  );
}

export function validatePwaInstallMetadataPolicy(
  manifest: PwaManifestMetadata,
): PwaInstallMetadataFailureCode | undefined {
  if (!hasInstallName(manifest)) return "INSTALL_NAME_MISSING";
  if (manifest.display !== "standalone") return "DISPLAY_NOT_STANDALONE";
  if (manifest.orientation !== "portrait") return "ORIENTATION_NOT_PORTRAIT";
  if (manifest.startUrl !== "/" || manifest.scope !== "/") {
    return "INVALID_SCOPE";
  }
  if (!hasRequiredInstallIcons(manifest)) return "INSTALL_ICON_MISSING";
  return undefined;
}
