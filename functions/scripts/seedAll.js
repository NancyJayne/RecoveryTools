// functions/scripts/seedAll.js
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scripts = [
  "seedUserRoles.js",
  "seedShopSettings.js",
  "seedDemoData.js",
];

console.log(`\n${chalk.green.bold("🌱 Seeding all emulator data")}`);
console.log(chalk.gray("============================\n"));

for (const script of scripts) {
  const fullPath = path.join(__dirname, script);
  console.log(`${chalk.cyan("▶ Running:")} ${script}`);

  try {
    execSync(`node "${fullPath}"`, {
      stdio: "inherit",
      env: {
        ...process.env,
        GCLOUD_PROJECT: "recovery-tools",
        FIRESTORE_EMULATOR_HOST: "localhost:8080",
      },
    });
  } catch (err) {
    console.error(chalk.red(`\n❌ Seeding failed: ${script} exited with code ${err.status}`));
    process.exit(1);
  }
}
