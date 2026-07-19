import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import chalk from "chalk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function findWorkbooks(directory) {
  if (!fs.existsSync(directory)) return [];
  const results = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (/^Recovery Tools Master Database.*\.xlsx$/i.test(entry.name)) {
        results.push({ path: fullPath, modified: fs.statSync(fullPath).mtimeMs });
      }
    }
  };
  visit(directory);
  return results;
}

function resolveWorkbookPath() {
  const requested = getArgValue("--workbook") ||
    process.env.RECOVERY_MASTER_WORKBOOK ||
    process.env.RECOVERY_PRODUCTS_WORKBOOK;
  if (requested) return path.resolve(requested);

  const candidates = [
    ...findWorkbooks(path.join(projectRoot, "outputs")),
    ...findWorkbooks(path.join(os.homedir(), "Downloads")),
  ].sort((left, right) => right.modified - left.modified);
  return candidates[0]?.path || null;
}

function runScript(script, args = []) {
  const fullPath = path.join(__dirname, script);
  console.log(`${chalk.cyan("Running:")} ${script} ${args.join(" ")}`.trim());
  execFileSync(process.execPath, [fullPath, ...args], {
    stdio: "inherit",
    env: {
      ...process.env,
      GCLOUD_PROJECT: "recovery-tools",
      FIRESTORE_EMULATOR_HOST: "localhost:8080",
      FIREBASE_AUTH_EMULATOR_HOST: "localhost:9100",
    },
  });
}

console.log(`\n${chalk.green.bold("Seeding all emulator data")}`);
console.log(chalk.gray("============================\n"));

const workbookPath = resolveWorkbookPath();
if (!workbookPath || !fs.existsSync(workbookPath)) {
  console.error(chalk.red("No Recovery Tools Master Database workbook was found."));
  console.error("Pass --workbook <path> or set RECOVERY_MASTER_WORKBOOK.");
  process.exit(1);
}

try {
  if (process.argv.includes("--dry-run")) {
    runScript("importMasterDatabase.js", ["--dry-run", workbookPath]);
    console.log(chalk.green(`\nValidated the full master workbook: ${workbookPath}`));
    process.exit(0);
  }
  runScript("seedUserRoles.js");
  runScript("seedShopSettings.js");
  runScript("importMasterDatabase.js", ["--emulator", workbookPath]);
  console.log(chalk.green(`\nSeeded the full master workbook: ${workbookPath}`));
} catch (error) {
  console.error(chalk.red(`\nSeeding failed with code ${error.status ?? 1}.`));
  process.exit(1);
}
