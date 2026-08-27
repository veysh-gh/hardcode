import { spawn } from "node:child_process";
import path from "node:path";
import { isPathInside } from "../shared/paths.mjs";
import { IPC } from "../ipc/contracts.mjs";
import { resolveIpcRouter } from "../ipc/router.mjs";

function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", cwd, ...args], { windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => reject(new Error(`Git is unavailable: ${error.message}`)));
    child.once("close", (code) => {
      const output = Buffer.concat(stdout).toString("utf8");
      const error = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) reject(new Error(error || `git ${args[0]} failed.`));
      else resolve(output);
    });
  });
}

function changes(output) {
  const staged = [];
  const unstaged = [];
  const entries = output.split("\0");
  for (let index = 0; index < entries.length - 1; index += 1) {
    const entry = entries[index];
    const status = entry.slice(0, 2);
    const filePath = entry.slice(3);
    if (status === "??") {
      unstaged.push({ path: filePath, status: "?" });
      continue;
    }
    if (status[0] === "R" || status[0] === "C") index += 1;
    if (status[0] && status[0] !== " ") staged.push({ path: filePath, status: status[0] });
    if (status[1] && status[1] !== " ") unstaged.push({ path: filePath, status: status[1] });
  }
  return { staged, unstaged };
}

function containsRepository(workspace, repositoryRoot) {
  return workspace.folders.some((folder) =>
    isPathInside(repositoryRoot, folder.path) || isPathInside(folder.path, repositoryRoot),
  );
}

export function registerGitIpc({ ipc, ipcMain, workspaceStore, overlayMountManager }) {
  const router = resolveIpcRouter({ ipc, ipcMain });

  async function checkedRepository(workspaceId, repositoryRoot) {
    const workspace = await workspaceStore.requireWorkspace(workspaceId);
    if (typeof repositoryRoot !== "string" || !containsRepository(workspace, repositoryRoot)) {
      throw new Error("Repository is outside this workspace.");
    }
    const root = (await runGit(repositoryRoot, ["rev-parse", "--show-toplevel"])).trim();
    if (path.resolve(root).toLowerCase() !== path.resolve(repositoryRoot).toLowerCase()) {
      throw new Error("Repository root is invalid.");
    }
    return root;
  }

  router.handle(IPC.git.status, async (_event, { workspaceId }) => {
    const workspace = await workspaceStore.requireWorkspace(workspaceId);
    const repositories = [];
    const seen = new Set();
    for (const folder of workspace.folders) {
      try {
        const root = (await runGit(folder.path, ["rev-parse", "--show-toplevel"])).trim();
        if (!root || seen.has(root.toLowerCase())) continue;
        seen.add(root.toLowerCase());
        const [branchResult, statusResult] = await Promise.all([
          runGit(root, ["branch", "--show-current"]),
          runGit(root, ["status", "--porcelain=v1", "-z"]),
        ]);
        repositories.push({
          root,
          name: path.basename(root),
          branch: branchResult.trim(),
          ...changes(statusResult),
        });
      } catch (error) {
        if (!String(error?.message ?? error).includes("not a git repository")) throw error;
      }
    }
    return repositories;
  });

  router.handle(IPC.git.updateIndex, async (
    _event,
    { workspaceId, repositoryRoot, action, filePath },
  ) => {
    const root = await checkedRepository(workspaceId, repositoryRoot);
    if (path.isAbsolute(filePath) || filePath.split(/[\\/]+/).includes("..")) {
      throw new Error("Invalid Git change.");
    }
    await runGit(root, action === "stage" ? ["add", "--", filePath] : ["restore", "--staged", "--", filePath]);
  });

  router.handle(IPC.git.commit, async (_event, { workspaceId, repositoryRoot, message }) => {
    if (overlayMountManager.current()) throw new Error("Unmount the active task before committing project changes.");
    const root = await checkedRepository(workspaceId, repositoryRoot);
    await runGit(root, ["commit", "-m", message.trim()]);
  });
}
