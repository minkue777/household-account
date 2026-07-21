#!/usr/bin/env node

import { createHash } from "node:crypto";

import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function usage(message) {
  if (message) console.error(message);
  console.error(
    "Usage: node scripts/set-system-admin-claim.mjs --project PROJECT_ID --uid FIREBASE_UID (--enable|--disable) [--apply]",
  );
  process.exit(1);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) return undefined;
  return process.argv[index + 1];
}

const allowedArguments = new Set([
  "--project",
  "--uid",
  "--enable",
  "--disable",
  "--apply",
]);
for (const value of process.argv.slice(2)) {
  if (value.startsWith("--") && !allowedArguments.has(value)) {
    usage(`Unknown argument: ${value}`);
  }
}

const projectId = argument("--project");
const uid = argument("--uid");
const enable = process.argv.includes("--enable");
const disable = process.argv.includes("--disable");
const apply = process.argv.includes("--apply");

if (
  typeof projectId !== "string" ||
  !/^[a-z][a-z0-9-]{4,29}$/u.test(projectId)
) {
  usage("A valid explicit --project is required.");
}
if (
  typeof uid !== "string" ||
  uid.length < 1 ||
  uid.length > 128 ||
  /\s/u.test(uid)
) {
  usage("A valid explicit --uid is required.");
}
if (enable === disable) usage("Choose exactly one of --enable or --disable.");

const app = initializeApp({
  credential: applicationDefault(),
  projectId,
});
const auth = getAuth(app);
const user = await auth.getUser(uid);
const currentClaims = user.customClaims ?? {};
const nextClaims = { ...currentClaims };
if (enable) nextClaims.systemAdmin = true;
else delete nextClaims.systemAdmin;

const uidHash = createHash("sha256").update(uid, "utf8").digest("hex");
const summary = {
  projectId,
  uidHash,
  operation: enable ? "ENABLE_SYSTEM_ADMIN" : "DISABLE_SYSTEM_ADMIN",
  currentSystemAdmin: currentClaims.systemAdmin === true,
  nextSystemAdmin: enable,
  apply,
};

if (!apply) {
  console.log(JSON.stringify(summary, null, 2));
  console.log("Dry run only. Re-run with --apply after verifying the project and UID.");
  process.exit(0);
}

await auth.setCustomUserClaims(uid, nextClaims);
console.log(JSON.stringify({ ...summary, applied: true }, null, 2));
console.log(
  "The user must sign out and sign in again (or force-refresh the ID token) before the claim is visible.",
);
