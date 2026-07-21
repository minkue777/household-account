import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const contractRoot = new URL("../../../contracts/", import.meta.url);

export function readContractJson<T>(relativePath: string): T {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, contractRoot)), "utf8"),
  ) as T;
}
