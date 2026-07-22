import { spawn } from "node:child_process";

const discoveryTimeout = process.env.FUNCTIONS_DISCOVERY_TIMEOUT || "60";
const command = process.platform === "win32" ? "firebase.cmd" : "firebase";
const child = spawn(command, ["emulators:start"], {
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
