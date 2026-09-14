import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const discoveryTimeout = process.env.FUNCTIONS_DISCOVERY_TIMEOUT || "60";
const windowsFirebase = resolve(process.env.APPDATA || "", "npm", "firebase.cmd");
const command = process.platform === "win32" && existsSync(windowsFirebase)
  ? windowsFirebase
  : process.platform === "win32" ? "firebase.cmd" : "firebase";
const emulatorDataArgument = ".firebase-emulator-data";
const emulatorDataDirectory = resolve(emulatorDataArgument);
const emulatorExportMetadata = resolve(emulatorDataDirectory, "firebase-export-metadata.json");
const args = [
  "emulators:start",
  "--project",
  "recovery-tools",
  "--export-on-exit",
  emulatorDataArgument,
];

if (existsSync(emulatorExportMetadata)) {
  args.push("--import", emulatorDataArgument);
  console.log(`Loading saved emulator data from ${emulatorDataDirectory}`);
} else {
  console.log(`No saved emulator data found. Data will be saved to ${emulatorDataDirectory} on exit.`);
}

const child = spawn(command, args, {
  env: {
    ...process.env,
    FUNCTIONS_DISCOVERY_TIMEOUT: discoveryTimeout,
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Unable to start Firebase emulators: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Firebase emulators stopped by signal ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
