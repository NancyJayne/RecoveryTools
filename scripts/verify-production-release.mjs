import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PRODUCTION_PROJECT = "recovery-tools";
const REQUIRED_CONFIRMATION = "DEPLOY RECOVERY TOOLS";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const branch = git("branch", "--show-current");
if (branch !== "main") {
  throw new Error(`Production releases must run from main, not ${branch || "a detached HEAD"}.`);
}

const status = git("status", "--porcelain");
if (status) {
  throw new Error("Production releases require a clean working tree. Commit or stash all changes first.");
}

const firebaseConfig = JSON.parse(readFileSync(new URL("../.firebaserc", import.meta.url), "utf8"));
if (!Object.values(firebaseConfig.projects || {}).includes(PRODUCTION_PROJECT)) {
  throw new Error(`.firebaserc is not linked to the expected ${PRODUCTION_PROJECT} project.`);
}

if (process.env.RECOVERY_TOOLS_PRODUCTION_RELEASE !== REQUIRED_CONFIRMATION) {
  throw new Error(
    `Set RECOVERY_TOOLS_PRODUCTION_RELEASE to "${REQUIRED_CONFIRMATION}" before a production release check.`,
  );
}

console.log(`Production release guard passed for ${PRODUCTION_PROJECT} on main.`);
