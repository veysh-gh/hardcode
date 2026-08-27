import { spawn } from "node:child_process";
import electronPath from "electron";

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ["."], {
  cwd: process.cwd(),
  env: environment,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
