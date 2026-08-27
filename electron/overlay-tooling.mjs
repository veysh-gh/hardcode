import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile, access } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createTwoFilesPatch } from "diff";
import { isPathInside } from "./shared/paths.mjs";
import {
  clearConflict,
  clearOverlayState,
  deletionMarkerSuffix,
  ensureBaseSnapshot,
  inspectOverlayTarget,
  synchronizeOverlayTarget,
} from "./overlay-merge.mjs";
import {
  DEFAULT_MAX_BYTES,
  createBashToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  defineTool,
  getPackageDir,
  truncateHead,
} from "@earendil-works/pi-coding-agent";

const LINUX_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const WSL_EXECUTABLE = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "wsl.exe");
let ripgrepPathPromise;

async function resolveRipgrepPath() {
  ripgrepPathPromise ??= import(pathToFileURL(path.join(getPackageDir(), "dist", "utils", "tools-manager.js")).href)
    .then(({ ensureTool }) => ensureTool("rg", true))
    .then((rgPath) => {
      if (!rgPath) throw new Error("ripgrep (rg) is unavailable. Install it or disable offline mode so Pi can provide its managed copy.");
      return rgPath;
    });
  return ripgrepPathPromise;
}

function runProcess(file, args, { cwd, env, onData, signal, timeout } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let timeoutHandle;
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => child.kill("SIGKILL");

    child.once("error", (error) => finish(reject, error));
    child.stdout.on("data", (data) => onData?.(data));
    child.stderr.on("data", (data) => onData?.(data));
    child.once("close", (exitCode) => finish(resolve, { exitCode }));

    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }
    if (timeout) {
      timeoutHandle = setTimeout(() => abort(), timeout * 1000);
    }
  });
}

async function captureProcess(file, args) {
  const chunks = [];
  const result = await runProcess(file, args, {
    onData: (data) => chunks.push(Buffer.from(data)),
  });
  return { ...result, output: Buffer.concat(chunks).toString("utf8").trim() };
}

function bwrapArguments(projectPath, command, sourcePaths = []) {
  const argumentsList = [
    "--die-with-parent",
    "--new-session",
    "--clearenv",
    "--setenv", "PATH", LINUX_PATH,
    "--setenv", "HOME", "/nonexistent",
    "--setenv", "TMPDIR", "/tmp",
    "--ro-bind-try", "/usr", "/usr",
    "--ro-bind-try", "/bin", "/bin",
    "--ro-bind-try", "/sbin", "/sbin",
    "--ro-bind-try", "/lib", "/lib",
    "--ro-bind-try", "/lib64", "/lib64",
    "--ro-bind-try", "/etc", "/etc",
    "--tmpfs", "/tmp",
    "--tmpfs", "/home",
    "--tmpfs", "/root",
    "--tmpfs", "/mnt",
    "--tmpfs", "/run",
    "--tmpfs", "/var",
    "--tmpfs", "/workspace",
    "--tmpfs", "/original",
    "--ro-bind", projectPath, "/workspace",
    "--proc", "/proc",
    "--dev", "/dev",
    "--unshare-net",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
  ];
  for (const [index, sourcePath] of sourcePaths.entries()) {
    argumentsList.push("--ro-bind", sourcePath, `/original/${index + 1}`);
  }
  argumentsList.push("--chdir", sourcePaths.length > 0 ? "/original/1" : "/workspace");
  return [...argumentsList, "/bin/bash", "-lc", command];
}

function sourceMappingsFrom(cwd, sourceRoots) {
  return sourceRoots
    .map((source) => ({
      sourcePath: typeof source === "string" ? source : source?.sourcePath,
      overlayPath: typeof source === "string" ? undefined : source?.overlayPath,
      logicalOverrides: typeof source === "string" ? undefined : source?.logicalOverrides,
      canUsePhysicalSource: typeof source === "string" ? undefined : source?.canUsePhysicalSource,
    }))
    .filter(({ sourcePath }) => typeof sourcePath === "string" && path.isAbsolute(sourcePath))
    .map(({ sourcePath, overlayPath, logicalOverrides, canUsePhysicalSource }) => ({
      sourcePath,
      overlayPath: typeof overlayPath === "string" && path.isAbsolute(overlayPath) ? overlayPath : cwd,
      logicalOverrides,
      canUsePhysicalSource,
    }));
}

function assertPhysicalSourcesAvailable(sourceMappings) {
  const hidden = sourceMappings.some((mapping) =>
    mapping.logicalOverrides?.(mapping.sourcePath).length > 0 && !mapping.canUsePhysicalSource?.(),
  );
  if (hidden) {
    throw new Error("Bash is unavailable while another task is mounted because it cannot expose that task's temporary files as the logical original. Use the overlay-aware read, grep, find, and ls tools instead.");
  }
}

function replaceKnownPath(command, hostPath, sandboxPath) {
  if (!hostPath) return command;
  const variants = [...new Set([hostPath, hostPath.replace(/\\/g, "/")])].sort((left, right) => right.length - left.length);
  let rewritten = command;
  for (const variant of variants) rewritten = rewritten.split(variant).join(sandboxPath);
  return rewritten;
}

function rewriteHostPathsForSandbox(command, cwd, sourceMappings) {
  let rewritten = command;
  // Agent context contains host overlay paths. The overlay is sparse, so an
  // absolute overlay path is most often an attempt to read the original file.
  // Route it to the corresponding original root; overlay files remain
  // explicitly available under /workspace.
  for (const [index, mapping] of sourceMappings.entries()) {
    rewritten = replaceKnownPath(rewritten, mapping.overlayPath, `/original/${index + 1}`);
    rewritten = replaceKnownPath(rewritten, mapping.sourcePath, `/original/${index + 1}`);
  }
  return replaceKnownPath(rewritten, cwd, "/workspace");
}

function createLinuxSandboxOperations(sourceMappings) {
  const sourcePaths = sourceMappings.map(({ sourcePath }) => sourcePath);
  return {
    exec: async (command, cwd, options) => {
      assertPhysicalSourcesAvailable(sourceMappings);
      try {
        return await runProcess("bwrap", bwrapArguments(cwd, rewriteHostPathsForSandbox(command, cwd, sourceMappings), sourcePaths), options);
      } catch (error) {
        if (error?.code === "ENOENT") {
          throw new Error("Secure Bash is unavailable: bwrap is not installed. Install bubblewrap before using the bash tool.");
        }
        throw error;
      }
    },
  };
}

async function findWslDistroWithBwrap() {
  let listed;
  try {
    listed = await captureProcess(WSL_EXECUTABLE, ["--list", "--quiet"]);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("Secure Bash is unavailable: WSL is not installed. Install WSL2 and an existing Linux distribution first.");
    }
    throw error;
  }
  if (listed.exitCode !== 0) {
    throw new Error(`Secure Bash is unavailable: WSL could not list installed distributions${listed.output ? `: ${listed.output}` : "."}`);
  }
  const distros = listed.output.split(/\r?\n/).map((entry) => entry.replace(/\0/g, "").trim()).filter(Boolean);
  if (distros.length === 0) {
    throw new Error("Secure Bash is unavailable: no WSL Linux distribution is installed. Install one, then install bubblewrap in it.");
  }
  for (const distro of distros) {
    const probe = await captureProcess(WSL_EXECUTABLE, ["--distribution", distro, "--exec", "bwrap", "--version"]);
    if (probe.exitCode === 0) return distro;
  }

  // Use the first existing distribution only. The setup must never create or
  // alter another WSL distribution merely to satisfy this dependency.
  const distro = distros[0];
  const installer = await captureProcess(WSL_EXECUTABLE, [
    "--distribution", distro,
    "--user", "root",
    "--exec", "/bin/sh", "-lc",
    [
      "set -eu",
      "if command -v apt-get >/dev/null 2>&1; then",
      "  export DEBIAN_FRONTEND=noninteractive",
      "  apt-get update",
      "  apt-get install -y bubblewrap",
      "elif command -v dnf >/dev/null 2>&1; then",
      "  dnf install -y bubblewrap",
      "elif command -v pacman >/dev/null 2>&1; then",
      "  pacman -Sy --noconfirm bubblewrap",
      "else",
      "  echo 'No supported package manager found (apt-get, dnf, or pacman).' >&2",
      "  exit 127",
      "fi",
      "command -v bwrap >/dev/null",
    ].join("\n"),
  ]);
  if (installer.exitCode !== 0) {
    throw new Error(`Secure Bash could not install bubblewrap in the existing WSL distribution ${distro}${installer.output ? `: ${installer.output}` : "."}`);
  }

  const verify = await captureProcess(WSL_EXECUTABLE, ["--distribution", distro, "--exec", "bwrap", "--version"]);
  if (verify.exitCode === 0) return distro;
  throw new Error(`Secure Bash installed bubblewrap in ${distro}, but bwrap is still not available. Restart WSL and try again.`);
}

async function windowsPathToWslPath(distro, windowsPath) {
  const result = await captureProcess(WSL_EXECUTABLE, [
    "--distribution", distro,
    "--exec", "wslpath", "-a", "-u", windowsPath,
  ]);
  if (result.exitCode !== 0 || !result.output.startsWith("/")) {
    throw new Error("Secure Bash could not translate the project path for WSL.");
  }
  return result.output;
}

function createWindowsSandboxOperations(sourceMappings) {
  let distroPromise;
  return {
    exec: async (command, cwd, options) => {
      assertPhysicalSourcesAvailable(sourceMappings);
      distroPromise ??= findWslDistroWithBwrap();
      const distro = await distroPromise;
      const [projectPath, ...originalPaths] = await Promise.all(
        [cwd, ...sourceMappings.map(({ sourcePath }) => sourcePath)].map((hostPath) => windowsPathToWslPath(distro, hostPath)),
      );
      return runProcess(
        WSL_EXECUTABLE,
        [
          "--distribution", distro,
          "--exec", "bwrap",
          ...bwrapArguments(projectPath, rewriteHostPathsForSandbox(command, cwd, sourceMappings), originalPaths),
        ],
        options,
      );
    },
  };
}

/**
 * Pi tool-definition override used by both the embedded SDK session and the
 * bundled Pi terminal profile. It intentionally does not intercept user_bash.
 */
export function createSecureBashTool(cwd, sourceRoots = []) {
  const sourceMappings = sourceMappingsFrom(cwd, sourceRoots);
  if (process.platform === "win32") {
    return createBashToolDefinition(cwd, { operations: createWindowsSandboxOperations(sourceMappings), exposeSessionEnvironment: false });
  }
  if (process.platform === "linux") {
    return createBashToolDefinition(cwd, { operations: createLinuxSandboxOperations(sourceMappings), exposeSessionEnvironment: false });
  }
  return createBashToolDefinition(cwd, {
    operations: {
      exec: async () => {
        throw new Error(`Secure Bash is unavailable on ${process.platform}. Bash is blocked rather than falling back to an unsandboxed shell.`);
      },
    },
    exposeSessionEnvironment: false,
  });
}

function logicalSourcePath(root, projectPath) {
  return root.resolveSourcePath?.(projectPath) ?? projectPath;
}

export function resolveOverlayFilePath(cwd, sourceRoots, requestedPath, operation) {
  if (typeof requestedPath !== "string" || !requestedPath) throw new Error(`${operation} path is required.`);
  // A single-root task has one unambiguous logical project root. Resolve
  // ordinary relative paths against that root directly rather than relying on
  // the sparse overlay cwd. This keeps every file tool on the same project
  // path model and avoids a missing-overlay-file being mistaken for a missing
  // source file.
  if (!path.isAbsolute(requestedPath) && sourceRoots.length === 1) {
    const root = sourceRoots[0];
    const relativePath = path.normalize(requestedPath);
    if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
      throw new Error(`${operation} path is outside the project root.`);
    }
    return {
      sourcePath: logicalSourcePath(root, path.resolve(root.sourcePath, relativePath)),
      projectPath: path.resolve(root.sourcePath, relativePath),
      overlayPath: path.resolve(root.overlayPath, relativePath),
      basePath: path.resolve(root.basePath, relativePath),
      relativePath,
    };
  }
  const requested = path.resolve(cwd, requestedPath);
  // Overlay roots can live inside a source project (as they do when
  // Hardcode edits itself). Match every overlay before considering any
  // containing source root, including overlapping multi-root workspaces.
  for (const root of sourceRoots) {
    if (isPathInside(root.overlayPath, requested)) {
      const relativePath = path.relative(root.overlayPath, requested);
      return {
        sourcePath: logicalSourcePath(root, path.resolve(root.sourcePath, relativePath)),
        projectPath: path.resolve(root.sourcePath, relativePath),
        overlayPath: requested,
        basePath: path.resolve(root.basePath, relativePath),
        relativePath,
      };
    }
  }
  for (const root of sourceRoots) {
    if (isPathInside(root.sourcePath, requested)) {
      const relativePath = path.relative(root.sourcePath, requested);
      return {
        sourcePath: logicalSourcePath(root, requested),
        projectPath: requested,
        overlayPath: path.resolve(root.overlayPath, relativePath),
        basePath: path.resolve(root.basePath, relativePath),
        relativePath,
      };
    }
  }
  if (isPathInside(cwd, requested)) {
    return { sourcePath: undefined, overlayPath: requested, relativePath: path.relative(cwd, requested) };
  }
  throw new Error(`${operation} path is outside the task overlay and original project roots.`);
}

/** Resolve a project path to its original and task-overlay counterparts. */
function resolveOverlayPath(cwd, sourceRoots, requestedPath, operation, { allowRoot = false } = {}) {
  const target = resolveOverlayFilePath(cwd, sourceRoots, requestedPath, operation);
  if (!allowRoot && !target.relativePath) throw new Error(`${operation} cannot target a project root.`);
  return target;
}

async function assertFileOrMissing(filePath, label) {
  if (!existsSync(filePath)) return false;
  const details = await stat(filePath);
  if (!details.isFile()) throw new Error(`${label} only supports files, not directories or links.`);
  return true;
}

function deletionMarkerPath(overlayPath) {
  return `${overlayPath}${deletionMarkerSuffix}`;
}

async function removeOverlayFile(overlayPath) {
  if (existsSync(overlayPath)) await rm(overlayPath, { force: true });
}

async function overlayPathForMutation(cwd, sourceRoots, requestedPath, operation) {
  const target = resolveOverlayPath(cwd, sourceRoots, requestedPath, operation);
  await synchronizeOverlayTarget(target);
  await ensureBaseSnapshot(target);
  await clearConflict(target);
  const markerPath = deletionMarkerPath(target.overlayPath);
  if (existsSync(markerPath)) await rm(markerPath, { force: true });
  await mkdir(path.dirname(target.overlayPath), { recursive: true });
  return target;
}

async function ensureOverlayCopy(cwd, sourceRoots, requestedPath, operation) {
  const target = await overlayPathForMutation(cwd, sourceRoots, requestedPath, operation);
  if (!existsSync(target.overlayPath) && target.sourcePath && existsSync(target.sourcePath)) {
    const sourceDetails = await stat(target.sourcePath);
    if (!sourceDetails.isFile()) throw new Error(`${operation} only supports files, not directories or links.`);
    await copyFile(target.sourcePath, target.overlayPath);
  }
  return target;
}

/** Write task content, removing a redundant overlay copy when it matches the original byte-for-byte. */
async function writeOverlayContent(target, content) {
  const output = Buffer.from(content, "utf8");
  if (target.sourcePath && existsSync(target.sourcePath)) {
    const sourceDetails = await stat(target.sourcePath);
    if (sourceDetails.isFile() && (await readFile(target.sourcePath)).equals(output)) {
      await clearOverlayState(target);
      return;
    }
  }
  await writeFile(target.overlayPath, output);
}

async function collectTaskChanges(sourceRoots) {
  const changes = [];
  for (const root of sourceRoots) {
    const visit = async (directory, relative = "") => {
      if (!existsSync(directory)) return;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const overlayPath = path.join(directory, entry.name);
        const entryRelative = path.join(relative, entry.name);
        if (entry.isDirectory()) {
          await visit(overlayPath, entryRelative);
          continue;
        }
        if (!entry.isFile()) continue;
        if (entry.name.endsWith(deletionMarkerSuffix)) {
          const relativePath = entryRelative.slice(0, -deletionMarkerSuffix.length);
          const projectPath = path.join(root.sourcePath, relativePath);
          const sourcePath = logicalSourcePath(root, projectPath);
          const overlayPath = path.join(root.overlayPath, relativePath);
          const target = { sourcePath, projectPath, overlayPath, basePath: path.join(root.basePath, relativePath), relativePath };
          const change = await inspectOverlayTarget(target);
          if (change) changes.push({ root, ...change, relativePath, sourcePath, overlayPath });
          continue;
        }
        const projectPath = path.join(root.sourcePath, entryRelative);
        const sourcePath = logicalSourcePath(root, projectPath);
        const target = { sourcePath, projectPath, overlayPath, basePath: path.join(root.basePath, entryRelative), relativePath: entryRelative };
        const change = await inspectOverlayTarget(target);
        if (change) changes.push({ root, ...change, relativePath: entryRelative, sourcePath, overlayPath });
      }
    };
    await visit(root.overlayPath);
  }
  return changes.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function patchForTaskChange(change) {
  const original = change.type === "added" ? "" : await readFile(change.sourcePath, "utf8");
  const current = change.type === "deleted" ? "" : await readFile(change.overlayPath, "utf8");
  const relativePath = change.relativePath.replace(/\\/g, "/");
  return createTwoFilesPatch(
    change.type === "added" ? "/dev/null" : `original/${relativePath}`,
    change.type === "deleted" ? "/dev/null" : `task/${relativePath}`,
    original,
    current,
    "",
    "",
    { context: 3 },
  );
}

function createStatusTool(sourceRoots) {
  return defineTool({
    name: "status",
    label: "Show task status",
    description: "List all pending task-overlay changes. M means modified, A added, and D deleted.",
    promptSnippet: "Inspect the compact task change status",
    promptGuidelines: ["Use status to see all task changes before reviewing or reverting them."],
    parameters: { type: "object", properties: {} },
    async execute() {
      const changes = await collectTaskChanges(sourceRoots);
      if (changes.length === 0) return { content: [{ type: "text", text: "No task changes." }], details: { changes: [] } };
      const symbol = { modified: "M", added: "A", deleted: "D" };
      return {
        content: [{ type: "text", text: changes.map((change) => `${change.conflict ? "C" : symbol[change.type]} ${change.relativePath.replace(/\\/g, "/")}`).join("\n") }],
        details: { changes: changes.map(({ type, relativePath, conflict }) => ({ type, path: relativePath, conflict: Boolean(conflict) })) },
      };
    },
  });
}

function createRevertTool(cwd, sourceRoots, onDidMutate) {
  return defineTool({
    name: "revert",
    label: "Revert task changes",
    description: "Discard all task-overlay changes, or only the specified file changes, restoring the original project view. If this task is mounted, its live projection updates immediately.",
    promptSnippet: "Discard task-overlay changes",
    promptGuidelines: ["Use revert only when the user explicitly asks to discard task changes."],
    parameters: {
      type: "object",
      properties: { paths: { type: "array", items: { type: "string" }, description: "Optional project file paths; omit to discard every task change" } },
    },
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      if (!params.paths || params.paths.length === 0) {
        const changes = await collectTaskChanges(sourceRoots);
        for (const root of sourceRoots) {
          await rm(root.overlayPath, { recursive: true, force: true });
          await mkdir(root.overlayPath, { recursive: true });
          await rm(root.basePath, { recursive: true, force: true });
          await mkdir(root.basePath, { recursive: true });
        }
        await onDidMutate?.();
        return { content: [{ type: "text", text: `Reverted all ${changes.length} task change(s).` }], details: { paths: changes.map((change) => change.relativePath) } };
      }
      const reverted = [];
      for (const requestedPath of params.paths) {
        const target = resolveOverlayPath(cwd, sourceRoots, requestedPath, "Revert");
        const markerPath = deletionMarkerPath(target.overlayPath);
        if (!existsSync(target.overlayPath) && !existsSync(markerPath)) throw new Error(`No task change exists for: ${requestedPath}`);
        await clearOverlayState(target);
        await onDidMutate?.(target);
        reverted.push(target.relativePath);
      }
      return { content: [{ type: "text", text: `Reverted ${reverted.length} task change(s):\n${reverted.join("\n")}` }], details: { paths: reverted } };
    },
  });
}

function createDeleteTool(cwd, sourceRoots, onDidMutate) {
  return defineTool({
    name: "delete",
    label: "Delete file",
    description: "Delete a file from the task overlay. For an original project file, records its deletion so a mounted task removes it from the live project reversibly.",
    promptSnippet: "Delete one or more files from the task overlay",
    promptGuidelines: ["Use delete to remove files. Do not create .hardcode-delete markers manually."],
    parameters: {
      type: "object",
      properties: { paths: { type: "array", items: { type: "string" }, minItems: 1 } },
      required: ["paths"],
    },
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const deleted = [];
      for (const requestedPath of params.paths) {
        const target = resolveOverlayPath(cwd, sourceRoots, requestedPath, "Delete");
        await synchronizeOverlayTarget(target);
        const sourceExists = target.sourcePath ? await assertFileOrMissing(target.sourcePath, "Delete") : false;
        const overlayExists = await assertFileOrMissing(target.overlayPath, "Delete");
        const markerPath = deletionMarkerPath(target.overlayPath);
        if (!sourceExists && !overlayExists) throw new Error(`Delete target does not exist: ${requestedPath}`);
        await ensureBaseSnapshot(target);
        await clearConflict(target);
        await removeOverlayFile(target.overlayPath);
        if (sourceExists) {
          await mkdir(path.dirname(markerPath), { recursive: true });
          await writeFile(markerPath, "", "utf8");
        } else {
          await clearOverlayState(target);
        }
        await onDidMutate?.(target);
        deleted.push(target.relativePath);
      }
      return { content: [{ type: "text", text: `Deleted ${deleted.length} file(s):\n${deleted.join("\n")}` }], details: { paths: deleted } };
    },
  });
}

function createMoveTool(cwd, sourceRoots, onDidMutate) {
  return defineTool({
    name: "move",
    label: "Move or rename file",
    description: "Move or rename a file within the task overlay. Moving an original file creates the new overlay file and records the original path as deleted.",
    promptSnippet: "Move or rename a file in the task overlay",
    promptGuidelines: ["Use move to rename or relocate files. It refuses to overwrite a destination; delete the destination first if replacement is intended."],
    parameters: {
      type: "object",
      properties: { source: { type: "string" }, destination: { type: "string" } },
      required: ["source", "destination"],
    },
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const source = resolveOverlayPath(cwd, sourceRoots, params.source, "Move source");
      const destination = resolveOverlayPath(cwd, sourceRoots, params.destination, "Move destination");
      await synchronizeOverlayTarget(source);
      await synchronizeOverlayTarget(destination);
      if (source.overlayPath === destination.overlayPath) throw new Error("Move source and destination are the same file.");
      const sourceOriginalExists = source.sourcePath ? await assertFileOrMissing(source.sourcePath, "Move") : false;
      const sourceOverlayExists = await assertFileOrMissing(source.overlayPath, "Move");
      if (!sourceOriginalExists && !sourceOverlayExists) throw new Error(`Move source does not exist: ${params.source}`);
      const destinationOriginalExists = destination.sourcePath ? await assertFileOrMissing(destination.sourcePath, "Move") : false;
      const destinationOverlayExists = await assertFileOrMissing(destination.overlayPath, "Move");
      if (destinationOriginalExists || destinationOverlayExists || existsSync(deletionMarkerPath(destination.overlayPath))) {
        throw new Error(`Move destination already exists: ${params.destination}. Delete it first to replace it.`);
      }
      await ensureBaseSnapshot(source);
      await ensureBaseSnapshot(destination);
      await clearConflict(source);
      await clearConflict(destination);

      await mkdir(path.dirname(destination.overlayPath), { recursive: true });
      if (sourceOriginalExists) {
        await copyFile(sourceOverlayExists ? source.overlayPath : source.sourcePath, destination.overlayPath);
        await removeOverlayFile(source.overlayPath);
        await mkdir(path.dirname(deletionMarkerPath(source.overlayPath)), { recursive: true });
        await writeFile(deletionMarkerPath(source.overlayPath), "", "utf8");
      } else {
        await rename(source.overlayPath, destination.overlayPath);
        await clearOverlayState(source);
      }
      await onDidMutate?.(source);
      await onDidMutate?.(destination);
      return {
        content: [{ type: "text", text: `Moved ${source.relativePath} to ${destination.relativePath}` }],
        details: { source: source.relativePath, destination: destination.relativePath },
      };
    },
  });
}

function createDiffTool(cwd, sourceRoots) {
  return defineTool({
    name: "diff",
    label: "Show task diff",
    description: "Show unified diffs between original project files and their task-overlay versions. Omit path to show every task change, or provide a normal project file path for one file.",
    promptSnippet: "Inspect task changes as unified diffs",
    promptGuidelines: ["Use diff without a path for all task changes, or with a path to review one file."],
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional project file path, relative or absolute" },
      },
    },
    async execute(_toolCallId, params) {
      if (!params.path) {
        const changes = await collectTaskChanges(sourceRoots);
        if (changes.length === 0) return { content: [{ type: "text", text: "No task changes." }], details: { changes: [] } };
        const patch = (await Promise.all(changes.map(patchForTaskChange))).join("\n");
        const truncation = truncateHead(patch, { maxBytes: DEFAULT_MAX_BYTES, maxLines: Number.MAX_SAFE_INTEGER });
        const output = truncation.truncated
          ? `${truncation.content}\n\n[Diff truncated at ${DEFAULT_MAX_BYTES / 1024}KB. Use status, then diff with a path to inspect an individual file.]`
          : truncation.content;
        return {
          content: [{ type: "text", text: output }],
          details: {
            changes: changes.map(({ type, sourcePath }) => ({ type, path: sourcePath })),
            truncated: truncation.truncated,
          },
        };
      }
      const target = resolveOverlayPath(cwd, sourceRoots, params.path, "Diff");
      const sourceExists = target.sourcePath ? await assertFileOrMissing(target.sourcePath, "Diff") : false;
      const overlayExists = await assertFileOrMissing(target.overlayPath, "Diff");
      const deleted = existsSync(deletionMarkerPath(target.overlayPath));
      if (deleted && !sourceExists) throw new Error(`Diff target does not exist: ${params.path}`);
      if (!sourceExists && !overlayExists) throw new Error(`Diff target does not exist: ${params.path}`);

      const original = sourceExists ? await readFile(target.sourcePath, "utf8") : "";
      const current = deleted ? "" : overlayExists ? await readFile(target.overlayPath, "utf8") : original;
      if (original === current) {
        return { content: [{ type: "text", text: `No task changes for ${target.relativePath}.` }] };
      }

      const patch = await patchForTaskChange({
        type: deleted ? "deleted" : sourceExists ? "modified" : "added",
        relativePath: target.relativePath,
        sourcePath: target.sourcePath,
        overlayPath: target.overlayPath,
      });
      const truncation = truncateHead(patch, { maxBytes: DEFAULT_MAX_BYTES, maxLines: Number.MAX_SAFE_INTEGER });
      const output = truncation.truncated
        ? `${truncation.content}\n\n[Diff truncated at ${DEFAULT_MAX_BYTES / 1024}KB. Narrow the file or inspect with read around the changed sections.]`
        : truncation.content;
      return {
        content: [{ type: "text", text: output }],
        details: { path: target.relativePath, status: deleted ? "deleted" : sourceExists ? "modified" : "added", truncated: truncation.truncated },
      };
    },
  });
}

async function ripgrepJson(args) {
  const rgPath = await resolveRipgrepPath();
  return new Promise((resolve, reject) => {
    const child = spawn(rgPath, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.once("error", (error) => reject(new Error(`ripgrep (rg) is unavailable: ${error.message}`)));
    child.stdout.on("data", (data) => stdout.push(Buffer.from(data)));
    child.stderr.on("data", (data) => stderr.push(Buffer.from(data)));
    child.once("close", (exitCode) => {
      const output = Buffer.concat(stdout).toString("utf8");
      const error = Buffer.concat(stderr).toString("utf8").trim();
      if (exitCode !== 0 && exitCode !== 1) {
        reject(new Error(error || `ripgrep exited with code ${exitCode}`));
      } else {
        resolve(output.split(/\r?\n/).filter(Boolean).flatMap((line) => {
          try {
            const event = JSON.parse(line);
            return event.type === "match" ? [event.data] : [];
          } catch {
            return [];
          }
        }));
      }
    });
  });
}

async function ripgrepFiles(args) {
  const rgPath = await resolveRipgrepPath();
  return new Promise((resolve, reject) => {
    const child = spawn(rgPath, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.once("error", (error) => reject(new Error(`ripgrep (rg) is unavailable: ${error.message}`)));
    child.stdout.on("data", (data) => stdout.push(Buffer.from(data)));
    child.stderr.on("data", (data) => stderr.push(Buffer.from(data)));
    child.once("close", (exitCode) => {
      const error = Buffer.concat(stderr).toString("utf8").trim();
      if (exitCode !== 0 && exitCode !== 1) reject(new Error(error || `ripgrep exited with code ${exitCode}`));
      else resolve(Buffer.concat(stdout).toString("utf8").split(/\r?\n/).filter(Boolean));
    });
  });
}

function matchingSearchRoots(cwd, sourceRoots, requestedPath) {
  if (!requestedPath) return sourceRoots.map((root) => ({ root, relativePath: "" }));
  const requested = path.resolve(cwd, requestedPath);
  for (const root of sourceRoots) {
    if (isPathInside(root.overlayPath, requested)) return [{ root, relativePath: path.relative(root.overlayPath, requested) }];
  }
  for (const root of sourceRoots) {
    if (isPathInside(root.sourcePath, requested)) return [{ root, relativePath: path.relative(root.sourcePath, requested) }];
  }
  throw new Error(`Grep path is outside the task overlay and original project roots: ${requestedPath}`);
}

function createGrepTool(cwd, sourceRoots) {
  return defineTool({
    name: "grep",
    label: "Search task files",
    description: "Search the merged task working tree with ripgrep. Uses normal relative or absolute project paths and returns matching lines with paths and line numbers.",
    promptSnippet: "Search the merged task working tree",
    promptGuidelines: ["Use grep to search code instead of shell grep or rg."],
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern, or literal text when literal is true" },
        path: { type: "string", description: "Optional project file or directory path; defaults to all project roots" },
        glob: { type: "string", description: "Optional ripgrep glob, for example *.ts" },
        ignoreCase: { type: "boolean", description: "Case-insensitive search" },
        literal: { type: "boolean", description: "Treat pattern as literal text rather than a regex" },
        limit: { type: "number", description: "Maximum number of matches to return; defaults to 100" },
      },
      required: ["pattern"],
    },
    async execute(_toolCallId, params) {
      await collectTaskChanges(sourceRoots);
      const roots = matchingSearchRoots(cwd, sourceRoots, params.path);
      const matches = [];
      for (const { root, relativePath } of roots) {
        const sourceSearchPath = path.join(root.sourcePath, relativePath);
        const overlaySearchPath = path.join(root.overlayPath, relativePath);
        const logicalOverrides = root.logicalOverrides?.(root.sourcePath) ?? [];
        const baseArgs = ["--json", "--line-number", "--color=never", "--glob", "!*.hardcode-delete"];
        if (params.ignoreCase) baseArgs.push("--ignore-case");
        if (params.literal) baseArgs.push("--fixed-strings");
        if (params.glob) baseArgs.push("--glob", params.glob);
        const search = async (searchPath, kind) => {
          if (!existsSync(searchPath)) return;
          const results = await ripgrepJson([...baseArgs, "--", params.pattern, searchPath]);
          for (const result of results) {
            const filePath = result.path?.text;
            const lineNumber = result.line_number;
            if (!filePath || typeof lineNumber !== "number") continue;
            const relativeFilePath = path.relative(kind === "original" ? root.sourcePath : root.overlayPath, filePath);
            if (!relativeFilePath || relativeFilePath.startsWith("..") || path.isAbsolute(relativeFilePath)) continue;
            if (kind === "original") {
              if (logicalOverrides.some((entry) => path.resolve(entry.projectPath) === path.resolve(filePath))) continue;
              const overlayFile = path.join(root.overlayPath, relativeFilePath);
              if (existsSync(overlayFile) || existsSync(deletionMarkerPath(overlayFile))) continue;
            }
            const text = String(result.lines?.text ?? "").replace(/\r?\n$/, "").replace(/\r/g, "");
            matches.push({
              path: relativeFilePath.replace(/\\/g, "/"),
              sourcePath: path.join(root.sourcePath, relativeFilePath),
              lineNumber,
              text,
            });
          }
        };
        await search(sourceSearchPath, "original");
        for (const override of logicalOverrides) {
          if (!override.exists || !isPathInside(sourceSearchPath, override.projectPath)) continue;
          const overlayFile = path.join(root.overlayPath, override.relativePath);
          if (existsSync(overlayFile) || existsSync(deletionMarkerPath(overlayFile))) continue;
          const results = await ripgrepJson([...baseArgs, "--", params.pattern, override.logicalPath]);
          for (const result of results) {
            const lineNumber = result.line_number;
            if (typeof lineNumber !== "number") continue;
            const text = String(result.lines?.text ?? "").replace(/\r?\n$/, "").replace(/\r/g, "");
            matches.push({
              path: override.relativePath.replace(/\\/g, "/"),
              sourcePath: override.projectPath,
              lineNumber,
              text,
            });
          }
        }
        await search(overlaySearchPath, "overlay");
      }
      matches.sort((left, right) => left.path.localeCompare(right.path) || left.lineNumber - right.lineNumber);
      const limit = Math.max(1, params.limit ?? 100);
      const visible = matches.slice(0, limit);
      if (visible.length === 0) return { content: [{ type: "text", text: "No matches found" }] };
      const rawOutput = visible.map((match) => `${match.path}:${match.lineNumber}: ${match.text}`).join("\n");
      const truncation = truncateHead(rawOutput, { maxBytes: DEFAULT_MAX_BYTES, maxLines: Number.MAX_SAFE_INTEGER });
      let output = truncation.content;
      if (matches.length > limit) output += `\n\n[${limit} matches limit reached. Use a higher limit or refine the pattern.]`;
      if (truncation.truncated) output += `\n\n[Results truncated at ${DEFAULT_MAX_BYTES / 1024}KB. Refine the pattern or path.]`;
      return {
        content: [{ type: "text", text: output }],
        details: {
          matches: visible.length,
          paths: [...new Set(matches.map((match) => match.sourcePath))],
          truncated: truncation.truncated || matches.length > limit,
        },
      };
    },
  });
}

function createFindTool(cwd, sourceRoots) {
  return defineTool({
    name: "find",
    label: "Find task files",
    description: "Find files by glob pattern in the merged task working tree. Uses normal relative or absolute project paths.",
    promptSnippet: "Find files by name in the merged task working tree",
    promptGuidelines: ["Use find to locate files by name instead of shell find or fd."],
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern, for example **/*.ts or *config*" },
        path: { type: "string", description: "Optional project directory or file path; defaults to all project roots" },
        limit: { type: "number", description: "Maximum number of files to return; defaults to 100" },
      },
      required: ["pattern"],
    },
    async execute(_toolCallId, params) {
      await collectTaskChanges(sourceRoots);
      const roots = matchingSearchRoots(cwd, sourceRoots, params.path);
      const files = new Set();
      for (const { root, relativePath } of roots) {
        const sourceSearchPath = path.join(root.sourcePath, relativePath);
        const logicalOverrides = root.logicalOverrides?.(root.sourcePath) ?? [];
        for (const [basePath, kind] of [[root.sourcePath, "original"], [root.overlayPath, "overlay"]]) {
          const searchPath = path.join(basePath, relativePath);
          if (!existsSync(searchPath)) continue;
          const found = await ripgrepFiles(["--files", "--hidden", "--glob", params.pattern, "--glob", "!*.hardcode-delete", searchPath]);
          for (const entry of found) {
            const filePath = path.resolve(entry);
            const relativeFilePath = path.relative(basePath, filePath);
            if (!relativeFilePath || relativeFilePath.startsWith("..") || path.isAbsolute(relativeFilePath)) continue;
            const overlayFile = path.join(root.overlayPath, relativeFilePath);
            if (kind === "original" && logicalOverrides.some((entry) => path.resolve(entry.projectPath) === filePath)) continue;
            if (kind === "original" && (existsSync(overlayFile) || existsSync(deletionMarkerPath(overlayFile)))) continue;
            files.add(relativeFilePath.replace(/\\/g, "/"));
          }
        }
        for (const override of logicalOverrides) {
          if (!override.exists || !isPathInside(sourceSearchPath, override.projectPath)) continue;
          const overlayFile = path.join(root.overlayPath, override.relativePath);
          if (existsSync(overlayFile) || existsSync(deletionMarkerPath(overlayFile))) continue;
          const found = await ripgrepFiles(["--files", "--hidden", "--glob", params.pattern, override.logicalPath]);
          if (found.length > 0) files.add(override.relativePath.replace(/\\/g, "/"));
        }
      }
      const limit = Math.max(1, params.limit ?? 100);
      const results = [...files].sort((left, right) => left.localeCompare(right));
      const visible = results.slice(0, limit);
      if (visible.length === 0) return { content: [{ type: "text", text: "No files found" }] };
      let output = visible.join("\n");
      if (results.length > limit) output += `\n\n[${limit} results limit reached. Use a higher limit or refine the pattern.]`;
      return { content: [{ type: "text", text: output }], details: { files: visible.length, truncated: results.length > limit } };
    },
  });
}

function createWcTool(cwd, sourceRoots) {
  return defineTool({
    name: "wc",
    label: "Count file lines",
    description: "Count newline-terminated lines in one or more files from the merged task working tree, equivalent to wc -l.",
    promptSnippet: "Count lines in merged task files",
    promptGuidelines: ["Use wc to count file lines instead of shell wc -l."],
    parameters: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, minItems: 1, description: "Project file paths, relative or absolute" },
      },
      required: ["paths"],
    },
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const counts = [];
      for (const requestedPath of params.paths) {
        const target = resolveOverlayPath(cwd, sourceRoots, requestedPath, "Count lines");
        if (existsSync(deletionMarkerPath(target.overlayPath))) throw new Error(`File is deleted in this task overlay: ${target.relativePath}`);
        const filePath = existsSync(target.overlayPath) ? target.overlayPath : target.sourcePath;
        if (!filePath || !(await assertFileOrMissing(filePath, "Count lines"))) throw new Error(`Count target does not exist: ${requestedPath}`);
        const content = await readFile(filePath);
        const lines = content.reduce((total, byte) => total + (byte === 10 ? 1 : 0), 0);
        counts.push({ path: target.relativePath.replace(/\\/g, "/"), lines });
      }
      const total = counts.reduce((sum, entry) => sum + entry.lines, 0);
      const output = counts.map((entry) => `${entry.lines} ${entry.path}`).concat(counts.length > 1 ? [`${total} total`] : []).join("\n");
      return { content: [{ type: "text", text: output }], details: { counts, total } };
    },
  });
}

function createExplainedWriteTool(cwd, operations) {
  return defineTool({
    name: "write",
    label: "Write file",
    description: "Write a file. Always provide a short, complete explanation of what changed and why it matters.",
    promptSnippet: "Write a file with a concise change explanation",
    promptGuidelines: ["Every write must include a short, complete technical explanation. Describe the functional change, not implementation mechanics."],
    parameters: {
      type: "object",
      required: ["path", "content", "explanation"],
      properties: {
        path: { type: "string", description: "Project file path" },
        content: { type: "string", description: "Complete file content" },
        explanation: { type: "string", description: "Short, complete explanation of the functional change" },
      },
    },
    async execute(_toolCallId, params) {
      if (!params.explanation?.trim()) throw new Error("A short change explanation is required.");
      await operations.write.writeFile(path.resolve(cwd, params.path), params.content);
      return { content: [{ type: "text", text: `Wrote ${params.path}` }] };
    },
  });
}

function createExplainedEditTool(cwd, operations) {
  return defineTool({
    name: "edit",
    label: "Edit file",
    description: "Apply exact text replacements to a file. Always provide a short, complete explanation of what changed and why it matters.",
    promptSnippet: "Edit a file with a concise change explanation",
    promptGuidelines: ["Every edit must include a short, complete explanation. Describe the functional change, not implementation mechanics."],
    parameters: {
      type: "object",
      required: ["path", "edits", "explanation"],
      properties: {
        path: { type: "string", description: "Project file path" },
        edits: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["oldText", "newText"],
            properties: { oldText: { type: "string" }, newText: { type: "string" } },
          },
          description: "Non-overlapping exact replacements, matched against the original file content",
        },
        explanation: { type: "string", description: "Short, complete explanation of the functional change" },
      },
    },
    async execute(_toolCallId, params) {
      if (!params.explanation?.trim()) throw new Error("A short change explanation is required.");
      const absolutePath = path.resolve(cwd, params.path);
      const original = (await operations.edit.readFile(absolutePath)).toString();
      const replacements = params.edits.map((edit) => {
        const start = original.indexOf(edit.oldText);
        if (start < 0 || start !== original.lastIndexOf(edit.oldText)) throw new Error("Each oldText must match one unique region in the original file.");
        return { start, end: start + edit.oldText.length, content: edit.newText };
      }).sort((left, right) => right.start - left.start);
      for (let index = 1; index < replacements.length; index += 1) {
        if (replacements[index - 1].start < replacements[index].end) throw new Error("Edit replacements must not overlap.");
      }
      let content = original;
      for (const replacement of replacements) content = `${content.slice(0, replacement.start)}${replacement.content}${content.slice(replacement.end)}`;
      await operations.edit.writeFile(absolutePath, content);
      return { content: [{ type: "text", text: `Edited ${params.path}` }] };
    },
  });
}

function createOverlayOperations(cwd, sourceRoots, onDidMutate) {
  const mergedFile = async (absolutePath, operation) => {
    const target = resolveOverlayPath(cwd, sourceRoots, absolutePath, operation);
    await synchronizeOverlayTarget(target);
    if (existsSync(deletionMarkerPath(target.overlayPath))) {
      throw new Error(`File is deleted in this task overlay: ${target.relativePath}`);
    }
    return existsSync(target.overlayPath) ? target.overlayPath : target.sourcePath ?? target.overlayPath;
  };
  return {
    read: {
      readFile: async (absolutePath) => readFile(await mergedFile(absolutePath, "read")),
      access: async (absolutePath) => access(await mergedFile(absolutePath, "read"), constants.R_OK),
    },
    write: {
      writeFile: async (absolutePath, content) => {
        const target = await overlayPathForMutation(cwd, sourceRoots, absolutePath, "write");
        await writeOverlayContent(target, content);
        await onDidMutate?.(target);
      },
      mkdir: async (directory) => {
        const target = resolveOverlayPath(cwd, sourceRoots, directory, "create a directory", { allowRoot: true });
        await mkdir(target.overlayPath, { recursive: true });
      },
    },
    edit: {
      readFile: async (absolutePath) => readFile(await mergedFile(absolutePath, "edit")),
      writeFile: async (absolutePath, content) => {
        const target = await ensureOverlayCopy(cwd, sourceRoots, absolutePath, "edit");
        await writeOverlayContent(target, content);
        await onDidMutate?.(target);
      },
      access: async (absolutePath) => access(await mergedFile(absolutePath, "edit"), constants.R_OK),
    },
    ls: {
      exists: async (absolutePath) => {
        try {
          await mergedFile(absolutePath, "list");
          return true;
        } catch (error) {
          if (error?.code === "ENOENT" || String(error?.message).startsWith("File is deleted")) return false;
          throw error;
        }
      },
      stat: async (absolutePath) => stat(await mergedFile(absolutePath, "list")),
      readdir: async (absolutePath) => {
        await collectTaskChanges(sourceRoots);
        const target = resolveOverlayPath(cwd, sourceRoots, absolutePath, "list", { allowRoot: true });
        if (existsSync(deletionMarkerPath(target.overlayPath))) throw new Error(`Directory is deleted in this task overlay: ${target.relativePath}`);
        const entries = new Set();
        const projectDirectory = target.projectPath ?? target.sourcePath;
        if (projectDirectory && existsSync(projectDirectory)) {
          const physicalEntries = (await readdir(projectDirectory)).map((name) => ({ name, type: "file" }));
          const logicalEntries = sourceRoots[0]?.adjustDirectoryEntries?.(projectDirectory, physicalEntries) ?? physicalEntries;
          for (const { name: entry } of logicalEntries) {
            if (!existsSync(deletionMarkerPath(path.join(target.overlayPath, entry)))) entries.add(entry);
          }
        }
        if (existsSync(target.overlayPath)) {
          for (const entry of await readdir(target.overlayPath)) {
            if (!entry.endsWith(".hardcode-delete")) entries.add(entry);
          }
        }
        return [...entries].sort((left, right) => left.localeCompare(right));
      },
    },
  };
}

/** Create the temporary overlay-bound SDK tools for one Pi session. */
export function createOverlayTooling({ cwd, sourceRoots, resolveSourcePath, logicalOverrides, adjustDirectoryEntries, canUsePhysicalSource, onDidMutate }) {
  const managedRoots = sourceRoots.map((root) => ({
    ...root,
    resolveSourcePath,
    logicalOverrides,
    adjustDirectoryEntries,
    canUsePhysicalSource,
  }));
  const operations = createOverlayOperations(cwd, managedRoots, onDidMutate);
  return {
    customTools: [
      // This intentionally overrides Pi's built-in agent `bash` tool. User-entered
      // `!` and `!!` commands use Pi's separate user_bash path and stay unchanged.
      createSecureBashTool(cwd, managedRoots),
      createReadToolDefinition(cwd, { operations: operations.read }),
      createExplainedEditTool(cwd, operations),
      createExplainedWriteTool(cwd, operations),
      createLsToolDefinition(cwd, { operations: operations.ls }),
      createStatusTool(managedRoots),
      createDiffTool(cwd, managedRoots),
      createGrepTool(cwd, managedRoots),
      createFindTool(cwd, managedRoots),
      createWcTool(cwd, managedRoots),
      createRevertTool(cwd, managedRoots, onDidMutate),
      createDeleteTool(cwd, managedRoots, onDidMutate),
      createMoveTool(cwd, managedRoots, onDidMutate),
    ],
    systemPrompt: `## Required task workflow\n- Treat the overlay-aware file tools as the normal and strongly preferred way to work. Use Bash when it is genuinely necessary for a read-only operation that these tools cannot express; do not reach for it by default.\n- Prefer read for file contents, ls for directory contents, find for file names, grep for text search, wc for line counts, status for a compact list of all task changes, and diff for task changes. Run diff without a path for all task diffs, or with a path to review one file. Prefer status and diff over git status or git diff when reviewing this task's changes.\n- Original-file updates are merged into touched overlay files automatically on file-tool access. A C entry in status is an unresolved conflict. Read shows its current result and diff compares that result with the original; resolve it with edit, write, or delete before mounting or completing the task.\n- Use write and edit for all file changes; edit automatically creates an overlay copy of an unchanged original file. Use delete for removals and move for renames/relocations. Use revert only when the user explicitly asks to discard task changes; omit paths to revert all changes or pass paths to revert specific files. Use ordinary relative or absolute project paths; never use checkout or create overlay markers manually.\n- Bash is available for exceptional read-only transformations such as a one-off awk or jq analysis. It is not the preferred path for routine file operations, search, Git, or edits. Bash runs in a read-only, network-isolated Linux container, starting in /original/1. Original roots are /original/1, /original/2, and so on; the sparse overlay is /workspace. Bash cannot modify either location. Host paths are translated automatically, but Windows host paths differ from the Linux container paths; when Bash is necessary, use its /original/N or /workspace paths (or normal relative paths from /original/1).`,
  };
}
