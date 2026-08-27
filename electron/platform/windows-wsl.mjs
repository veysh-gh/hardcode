import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const wslExecutable = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "wsl.exe");

function windowsWslState() {
  if (process.platform !== "win32") return { supported: false, accessible: false, distros: [], error: "" };
  const result = spawnSync(wslExecutable, ["--list", "--quiet"], { encoding: "utf8", windowsHide: true });
  if (result.error?.code === "ENOENT") return { supported: false, accessible: false, distros: [], error: "" };
  const output = `${result.stdout ?? ""}`.replace(/\0/g, "");
  const error = `${result.stderr ?? ""}`.replace(/\0/g, "").trim();
  return {
    supported: true,
    accessible: result.status === 0,
    distros: output.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean),
    error,
  };
}

export async function offerWindowsWslSetup(dialog) {
  const state = windowsWslState();
  if (process.platform !== "win32" || (state.accessible && state.distros.length > 0)) return;

  if (state.supported && !state.accessible) {
    await dialog.showMessageBox({
      type: "error",
      buttons: ["OK"],
      title: "Secure Bash unavailable",
      message: "Hardcode could not inspect WSL on this computer.",
      detail: `${state.error || "WSL returned an error."}\n\nAgent Bash remains blocked; fix the WSL service or its permissions, then restart Hardcode.`,
    });
    return;
  }

  const message = state.supported
    ? "Secure Bash needs an installed WSL Linux distribution. No distribution was found."
    : "Secure Bash needs Windows Subsystem for Linux (WSL2), but wsl.exe is not available on this computer.";
  const { response } = await dialog.showMessageBox({
    type: "warning",
    buttons: state.supported ? ["Install WSL and Ubuntu", "Keep Bash blocked"] : ["OK"],
    defaultId: 0,
    cancelId: state.supported ? 1 : 0,
    title: "Secure Bash setup",
    message,
    detail: state.supported
      ? "Hardcode will request Windows administrator permission. A restart may be required. Existing WSL distributions are always used instead of installing another one."
      : "Install or enable WSL2 through Windows first. Until then, Hardcode's agent bash tool remains blocked.",
  });
  if (!state.supported || response !== 0) return;

  const powerShell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  spawn(
    powerShell,
    ["-NoProfile", "-Command", "Start-Process -FilePath wsl.exe -ArgumentList '--install -d Ubuntu' -Verb RunAs -Wait"],
    { detached: true, stdio: "ignore", windowsHide: true },
  ).unref();
}
