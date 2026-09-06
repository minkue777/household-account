import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface DeploymentMarker {
  readonly releaseId: string;
  readonly commitSha: string;
  readonly artifactSha256: string;
}

/** Created only by the verified release wrapper; absent in ordinary local builds. */
export function readDeploymentMarker(path = join(__dirname, "deployment-marker.json")): DeploymentMarker | undefined {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return typeof value.releaseId === "string" && /^[a-f0-9]{40}$/u.test(value.commitSha) && /^[a-f0-9]{64}$/u.test(value.artifactSha256)
      ? { releaseId: value.releaseId, commitSha: value.commitSha, artifactSha256: value.artifactSha256 }
      : undefined;
  } catch { return undefined; }
}
