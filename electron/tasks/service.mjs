import { existsSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createOverlayMountManager } from "../overlay-mount.mjs";
import { isPathInside, resolveRelativePath } from "../shared/paths.mjs";
import {
  clearOverlayState,
  deletionMarkerSuffix,
  inspectOverlayTarget,
  synchronizeOverlayTarget,
} from "../overlay-merge.mjs";

export function createTaskService(workspaceStore) {
const workspaceDataPath = workspaceStore.dataPath;
const {
  taskOverlayPath,
  ensureTaskData,
} = workspaceStore;
let overlayMountManager;

function safePathSegment(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "root";
}

function taskArchivePath(workspace, task) {
  return path.join(taskOverlayPath(workspace, task), "archive");
}

function taskRootMappings(workspace, task) {
  const overlayRoot = taskOverlayPath(workspace, task);
  return workspace.folders.map((folder, index) => {
    const directoryName = `${index + 1}-${safePathSegment(path.basename(path.resolve(folder.path)))}`;
    return {
      index,
      sourcePath: path.resolve(folder.path),
      overlayPath: path.join(overlayRoot, directoryName),
      basePath: path.join(overlayRoot, "bases", directoryName),
      defaultBranch: folder.defaultBranch,
    };
  });
}

async function mergeOverlayEntry(source, target) {
  if (!existsSync(target)) {
    await rename(source, target);
    return;
  }
  const sourceStats = statSync(source);
  const targetStats = statSync(target);
  if (sourceStats.isDirectory() && targetStats.isDirectory()) {
    for (const entry of await readdir(source)) {
      await mergeOverlayEntry(path.join(source, entry), path.join(target, entry));
    }
    await rm(source, { recursive: true, force: true });
    return;
  }
  if (sourceStats.isFile() && targetStats.isFile() && (await filesEqual(source, target))) {
    await rm(source, { force: true });
    return;
  }
  throw new Error(`Conflicting overlay paths: ${source} and ${target}`);
}

async function looseOverlayEntries(overlayRoot, roots) {
  const reserved = new Set(["overlay.json", "archive", "bases", ...roots.map((root) => path.basename(root.overlayPath))]);
  return (await readdir(overlayRoot, { withFileTypes: true }))
    .filter((entry) => !reserved.has(entry.name))
    .map((entry) => path.join(overlayRoot, entry.name));
}

async function ensureTaskOverlay(workspace, task) {
  await ensureTaskData(workspace, task);
  const overlayRoot = taskOverlayPath(workspace, task);
  const roots = taskRootMappings(workspace, task);
  await mkdir(overlayRoot, { recursive: true });
  await Promise.all(roots.flatMap((root) => [
    mkdir(root.overlayPath, { recursive: true }),
    mkdir(root.basePath, { recursive: true }),
  ]));
  if (roots.length === 1) {
    for (const loosePath of await looseOverlayEntries(overlayRoot, roots)) {
      await mergeOverlayEntry(loosePath, path.join(roots[0].overlayPath, path.basename(loosePath)));
    }
  }
  await writeFile(
    path.join(overlayRoot, "overlay.json"),
    `${JSON.stringify({ workspaceId: workspace.id, taskId: task.id, roots }, null, 2)}\n`,
    "utf8",
  );
  return { overlayRoot, roots };
}

function resolveLogicalWorkspacePath(workspace, requestedPath) {
  if (typeof requestedPath !== "string" || !path.isAbsolute(requestedPath)) {
    throw new Error("Invalid workspace path.");
  }
  const candidate = path.resolve(requestedPath);
  for (const [folderIndex, folder] of workspace.folders.entries()) {
    const root = path.resolve(folder.path);
    if (isPathInside(root, candidate)) {
      const relative = path.relative(root, candidate);
      return { workspace, folderIndex, sourcePath: candidate, relativePath: relative };
    }
  }
  throw new Error("Path is outside the selected workspace.");
}

async function getTaskContext(workspaceId, taskId) {
  await overlayMountManager?.initialize();
  const { workspace, task } = await workspaceStore.requireTask(workspaceId, taskId);
  const overlay = await ensureTaskOverlay(workspace, task);
  return { workspace, task, ...overlay };
}

async function filesEqual(leftPath, rightPath) {
  if (!existsSync(leftPath) || !existsSync(rightPath)) return false;
  const [left, right] = await Promise.all([readFile(leftPath), readFile(rightPath)]);
  return left.equals(right);
}

async function overlayStatus(sourcePath, overlayPath, type) {
  if (existsSync(`${overlayPath}${deletionMarkerSuffix}`)) return "deleted";
  if (!existsSync(overlayPath)) return undefined;
  if (!existsSync(sourcePath)) return "added";
  if (type === "directory") return "modified";
  return (await filesEqual(sourcePath, overlayPath)) ? undefined : "modified";
}

async function collectOverlayOperations(mapping, overlayDirectory = mapping.overlayPath, relative = "") {
  const operations = [];
  const entries = await readdir(overlayDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error(`Overlay links are not supported: ${path.join(relative, entry.name)}`);
    }
    const overlayPath = path.join(overlayDirectory, entry.name);
    const entryRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      operations.push(...(await collectOverlayOperations(mapping, overlayPath, entryRelative)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(deletionMarkerSuffix)) {
      const targetRelative = entryRelative.slice(0, -deletionMarkerSuffix.length);
      const projectPath = path.join(mapping.sourcePath, targetRelative);
      const target = {
        sourcePath: overlayMountManager?.logicalPath(projectPath) ?? projectPath,
        projectPath,
        overlayPath: path.join(mapping.overlayPath, targetRelative),
        basePath: path.join(mapping.basePath, targetRelative),
        relativePath: targetRelative,
      };
      const change = await inspectOverlayTarget(target);
      if (change) operations.push({ ...change, ...target });
      continue;
    }
    const projectPath = path.join(mapping.sourcePath, entryRelative);
    const target = {
      sourcePath: overlayMountManager?.logicalPath(projectPath) ?? projectPath,
      projectPath,
      overlayPath,
      basePath: path.join(mapping.basePath, entryRelative),
      relativePath: entryRelative,
    };
    const change = await inspectOverlayTarget(target);
    if (change) operations.push({ ...change, ...target });
  }
  return operations;
}

async function archiveTaskCommit(workspace, task, rootOperations) {
  const archiveRoot = taskArchivePath(workspace, task);
  const commitPath = path.join(archiveRoot, `${Date.now()}-${randomUUID()}`);
  await mkdir(commitPath, { recursive: true });
  const manifest = [];
  for (const { root, operations } of rootOperations) {
    for (const operation of operations) {
      const key = `${root.index}/${operation.relativePath}`;
      const beforePath = path.join(commitPath, "before", String(root.index), operation.relativePath);
      const afterPath = path.join(commitPath, "after", String(root.index), operation.relativePath);
      const beforeExists = existsSync(operation.sourcePath) && statSync(operation.sourcePath).isFile();
      const afterExists = operation.type !== "deleted";
      if (beforeExists) {
        await mkdir(path.dirname(beforePath), { recursive: true });
        await copyFile(operation.sourcePath, beforePath);
      }
      if (afterExists) {
        await mkdir(path.dirname(afterPath), { recursive: true });
        await copyFile(operation.overlayPath, afterPath);
      }
      manifest.push({ key, rootIndex: root.index, relativePath: operation.relativePath, beforeExists, afterExists });
    }
  }
  await writeFile(path.join(commitPath, "commit.json"), `${JSON.stringify({ manifest }, null, 2)}\n`, "utf8");
}

async function taskArchiveOperations(workspace, task) {
  const archiveRoot = taskArchivePath(workspace, task);
  if (!existsSync(archiveRoot)) return [];
  const latest = new Map();
  const commits = (await readdir(archiveRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const commit of commits) {
    const commitPath = path.join(archiveRoot, commit.name);
    let parsed;
    try { parsed = JSON.parse(await readFile(path.join(commitPath, "commit.json"), "utf8")); } catch { continue; }
    for (const item of parsed.manifest ?? []) {
      if (
        !Number.isInteger(item.rootIndex) ||
        !workspace.folders[item.rootIndex] ||
        typeof item.relativePath !== "string"
      ) continue;
      const relativePath = path.normalize(item.relativePath);
      if (!relativePath || path.isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) continue;
      const beforePath = item.beforeExists
        ? path.join(commitPath, "before", String(item.rootIndex), relativePath)
        : undefined;
      const afterPath = item.afterExists
        ? path.join(commitPath, "after", String(item.rootIndex), relativePath)
        : undefined;
      const key = `${item.rootIndex}/${relativePath}`;
      const previous = latest.get(key);
      latest.set(key, {
        rootIndex: item.rootIndex,
        relativePath,
        sourcePath: path.join(workspace.folders[item.rootIndex].path, relativePath),
        beforePath: previous ? previous.beforePath : beforePath,
        afterPath,
      });
    }
  }
  return normalizeTaskOperations([...latest.values()]);
}

async function normalizeTaskOperations(operations) {
  const normalized = [];
  for (const operation of operations) {
    if (!operation.beforePath && !operation.afterPath) continue;
    if (
      operation.beforePath &&
      operation.afterPath &&
      (await filesEqual(operation.beforePath, operation.afterPath))
    ) {
      continue;
    }
    normalized.push({
      ...operation,
      type: operation.afterPath ? (operation.beforePath ? "modified" : "added") : "deleted",
    });
  }
  return normalized;
}

async function commitTaskOverlay(workspace, task) {
  const { roots } = await ensureTaskOverlay(workspace, task);
  const rootOperations = [];
  for (const root of roots) {
    rootOperations.push({ root, operations: await collectOverlayOperations(root) });
  }

  const conflicts = rootOperations.flatMap(({ root, operations }) =>
    operations
      .filter((operation) => operation.conflict)
      .map((operation) => `${root.sourcePath} :: ${operation.relativePath}`),
  );
  if (conflicts.length > 0) {
    throw new Error(`Resolve merge conflicts before completing:\n${conflicts.join("\n")}`);
  }

  await archiveTaskCommit(workspace, task, rootOperations);

  for (const { operations } of rootOperations) {
    for (const operation of operations) {
      const projectPath = operation.projectPath ?? operation.sourcePath;
      if (operation.type === "deleted") {
        await rm(projectPath, { force: true });
      } else {
        await mkdir(path.dirname(projectPath), { recursive: true });
        await copyFile(operation.overlayPath, projectPath);
      }
    }
  }

  for (const { root } of rootOperations) {
    await rm(root.overlayPath, { recursive: true, force: true });
    await mkdir(root.overlayPath, { recursive: true });
    await rm(root.basePath, { recursive: true, force: true });
    await mkdir(root.basePath, { recursive: true });
  }

  return rootOperations.flatMap(({ root, operations }) =>
    operations.map((operation) => ({
      root: root.sourcePath,
      path: operation.relativePath,
      status: operation.type,
    })),
  );
}

async function finishMountedTaskOverlay(workspace, task) {
  const { roots } = await ensureTaskOverlay(workspace, task);
  const rootOperations = [];
  for (const root of roots) {
    rootOperations.push({ root, operations: await collectOverlayOperations(root) });
  }
  if (rootOperations.some(({ operations }) => operations.some((operation) => operation.conflict))) {
    throw new Error("Resolve merge conflicts before completing this task.");
  }
  if (rootOperations.some(({ operations }) => operations.length > 0)) {
    await archiveTaskCommit(workspace, task, rootOperations);
  }
  await overlayMountManager.finalize(workspace.id, task.id);
  for (const { root } of rootOperations) {
    await rm(root.overlayPath, { recursive: true, force: true });
    await mkdir(root.overlayPath, { recursive: true });
    await rm(root.basePath, { recursive: true, force: true });
    await mkdir(root.basePath, { recursive: true });
  }
}

async function taskOverlayOperations(workspace, task, mode = "current") {
  const { overlayRoot, roots } = await ensureTaskOverlay(workspace, task);
  const current = [];
  for (const root of roots) {
    current.push(...(await collectOverlayOperations(root)).map((operation) => ({
      ...operation,
      rootIndex: root.index,
    })));
  }
  const unmappedPaths = await looseOverlayEntries(overlayRoot, roots);
  if (mode !== "task") return { operations: current, unmappedPaths };

  const combined = new Map(
    (await taskArchiveOperations(workspace, task)).map((operation) => [
      path.resolve(operation.projectPath ?? operation.sourcePath),
      operation,
    ]),
  );
  for (const operation of current) {
    const key = path.resolve(operation.projectPath ?? operation.sourcePath);
    const previous = combined.get(key);
    const sourceIsFile = existsSync(operation.sourcePath) && statSync(operation.sourcePath).isFile();
    combined.set(key, {
      ...previous,
      ...operation,
      beforePath: previous ? previous.beforePath : sourceIsFile ? operation.sourcePath : undefined,
      afterPath: operation.type === "deleted" ? undefined : operation.overlayPath,
    });
  }
  return { operations: await normalizeTaskOperations([...combined.values()]), unmappedPaths };
}

overlayMountManager = createOverlayMountManager({
  storagePath: path.join(workspaceDataPath, "_mounted-task"),
  getOperations: async (workspaceId, taskId) => {
    let context;
    try {
      context = await workspaceStore.requireTask(workspaceId, taskId);
    } catch {
      throw new Error("The mounted task no longer exists.");
    }
    const { workspace, task } = context;
    return taskOverlayOperations(workspace, task);
  },
});

async function removeTaskData(workspaceId, taskId) {
  const taskPath = resolveRelativePath(
    workspaceDataPath,
    path.join(workspaceId, "tasks", taskId),
    "Refusing to remove an unsafe task path.",
  );
  await rm(taskPath, { recursive: true, force: true });
}

async function removeTaskOverlay(workspaceId, taskId) {
  const overlayPath = resolveRelativePath(
    workspaceDataPath,
    path.join(workspaceId, "tasks", taskId, "overlays"),
    "Refusing to remove an unsafe task overlay path.",
  );
  await rm(overlayPath, { recursive: true, force: true });
}

return {
  overlayMountManager,
  ensureTaskOverlay,
  resolveLogicalWorkspacePath,
  getTaskContext,
  overlayStatus,
  taskOverlayOperations,
  commitTaskOverlay,
  finishMountedTaskOverlay,
  removeTaskData,
  removeTaskOverlay,
};
}
