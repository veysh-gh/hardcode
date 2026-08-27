import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isPathInside } from "../shared/paths.mjs";
import {
  clearConflict,
  clearOverlayState,
  deletionMarkerSuffix,
  ensureBaseSnapshot,
  readOverlayConflict,
  resolveOverlayConflict,
  synchronizeOverlayTarget,
} from "../overlay-merge.mjs";
import { IPC } from "../ipc/contracts.mjs";
import { resolveIpcRouter } from "../ipc/router.mjs";

export function registerWorkspaceFileIpc({ ipc, ipcMain, workspaceStore, taskService }) {
const router = resolveIpcRouter({ ipc, ipcMain });
const { queueWrite: queueWorkspaceWrite } = workspaceStore;
const {
  overlayMountManager,
  resolveLogicalWorkspacePath,
  getTaskContext,
  overlayStatus,
  taskOverlayOperations,
} = taskService;

router.handle(IPC.workspace.readDirectory, async (_event, { workspaceId, path: directoryPath, taskId, diffMode }) => {
  const mode = diffMode;
  const context = await getTaskContext(workspaceId, taskId);
  const scoped = resolveLogicalWorkspacePath(context.workspace, directoryPath);
  const overlayChanges = await taskOverlayOperations(context.workspace, context.task, mode);
  const changedPaths = overlayChanges.operations.map((operation) => path.resolve(operation.projectPath ?? operation.sourcePath));
  const changedByPath = new Map(overlayChanges.operations.map((operation) => [path.resolve(operation.projectPath ?? operation.sourcePath), operation]));
  const root = context.roots[scoped.folderIndex];
  const overlayDirectory = path.join(root.overlayPath, scoped.relativePath);
  const names = new Map();

  if (existsSync(scoped.sourcePath) && statSync(scoped.sourcePath).isDirectory()) {
    const physicalEntries = (await readdir(scoped.sourcePath, { withFileTypes: true }))
      .filter((entry) => entry.name !== ".git")
      .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "directory" : "file" }));
    for (const entry of overlayMountManager.adjustDirectoryEntries(scoped.sourcePath, physicalEntries)) {
      if (entry.name === ".git") continue;
      names.set(entry.name, entry);
    }
  }
  if (existsSync(overlayDirectory) && statSync(overlayDirectory).isDirectory()) {
    for (const entry of await readdir(overlayDirectory, { withFileTypes: true })) {
      const marker = entry.name.endsWith(deletionMarkerSuffix);
      const name = marker ? entry.name.slice(0, -deletionMarkerSuffix.length) : entry.name;
      if (!name) continue;
      const existing = names.get(name);
      names.set(name, {
        name,
        type: existing?.type ?? (entry.isDirectory() ? "directory" : "file"),
      });
    }
  }
  if (mode === "task") {
    for (const operation of overlayChanges.operations) {
      const operationPath = operation.projectPath ?? operation.sourcePath;
      if (!isPathInside(scoped.sourcePath, operationPath)) continue;
      const relative = path.relative(scoped.sourcePath, operationPath);
      if (!relative) continue;
      const parts = relative.split(path.sep);
      const name = parts[0];
      const existing = names.get(name);
      names.set(name, {
        name,
        type: existing?.type ?? (parts.length > 1 ? "directory" : "file"),
      });
    }
  }

  const entries = await Promise.all(
    [...names.values()].map(async (entry) => {
      const sourcePath = path.join(scoped.sourcePath, entry.name);
      const overlayPath = path.join(overlayDirectory, entry.name);
      return {
        ...entry,
        path: sourcePath,
        status:
          entry.type === "directory"
            ? changedPaths.some((changedPath) =>
                changedPath.startsWith(`${path.resolve(sourcePath)}${path.sep}`),
              )
              ? "modified"
              : undefined
            : changedPaths.includes(path.resolve(sourcePath))
              ? mode === "task"
                ? changedByPath.get(path.resolve(sourcePath))?.type
                : await overlayStatus(overlayMountManager.logicalPath(sourcePath), overlayPath, entry.type)
              : undefined,
      };
    }),
  );
  return entries.sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
});

router.handle(IPC.workspace.readFile, async (_event, { workspaceId, path: filePath, taskId, diffMode }) => {
  const mode = diffMode;
  const context = await getTaskContext(workspaceId, taskId);
  const scoped = resolveLogicalWorkspacePath(context.workspace, filePath);
  const root = context.roots[scoped.folderIndex];
  const overlayPath = path.join(root.overlayPath, scoped.relativePath);
  const logicalSourcePath = overlayMountManager.logicalPath(scoped.sourcePath);
  const overlayTarget = {
    sourcePath: logicalSourcePath,
    projectPath: scoped.sourcePath,
    overlayPath,
    basePath: path.join(root.basePath, scoped.relativePath),
    relativePath: scoped.relativePath,
  };
  if (mode !== "task") {
    await synchronizeOverlayTarget(overlayTarget);
  }
  const taskOperation = mode === "task"
    ? (await taskOverlayOperations(context.workspace, context.task, "task")).operations.find((operation) => path.resolve(operation.projectPath ?? operation.sourcePath) === path.resolve(scoped.sourcePath))
    : undefined;
  const deleted = taskOperation ? taskOperation.type === "deleted" : existsSync(`${overlayPath}${deletionMarkerSuffix}`);
  const sourceExists = existsSync(logicalSourcePath) && statSync(logicalSourcePath).isFile();
  const overlayExists = existsSync(overlayPath) && statSync(overlayPath).isFile();
  if (!taskOperation && !sourceExists && !overlayExists) throw new Error("File does not exist.");

  const [sourceContent, overlayContent] = await Promise.all([
    taskOperation
      ? taskOperation.beforePath
        ? readFile(taskOperation.beforePath)
        : Promise.resolve(Buffer.from(""))
      : sourceExists
        ? readFile(logicalSourcePath)
        : Promise.resolve(Buffer.from("")),
    taskOperation
      ? taskOperation.afterPath
        ? readFile(taskOperation.afterPath)
        : Promise.resolve(Buffer.from(""))
      : overlayExists
        ? readFile(overlayPath)
        : Promise.resolve(Buffer.from("")),
  ]);
  const displayedContent = deleted
    ? Buffer.from("")
    : taskOperation || overlayExists
      ? overlayContent
      : sourceContent;
  if (displayedContent.length > 2 * 1024 * 1024 || sourceContent.length > 2 * 1024 * 1024) {
    throw new Error("File is larger than 2 MB.");
  }
  if (displayedContent.subarray(0, 8192).includes(0) || sourceContent.subarray(0, 8192).includes(0)) {
    throw new Error("Binary files cannot be displayed.");
  }
  const status = taskOperation?.type ?? (deleted
    ? "deleted"
    : !sourceExists
      ? "added"
      : overlayExists && !sourceContent.equals(overlayContent)
        ? "modified"
        : undefined);
  const mergeConflict = status ? await readOverlayConflict(overlayTarget) : undefined;
  return {
    path: scoped.sourcePath,
    content: mergeConflict?.mergeContent ?? displayedContent.toString("utf8"),
    originalContent: status ? sourceContent.toString("utf8") : undefined,
    status,
    mergeConflict,
  };
});

router.handle(IPC.workspace.writeFile, (_event, { workspaceId, path: filePath, taskId, content }) =>
  queueWorkspaceWrite(async () => {
    if (typeof content !== "string") throw new Error("File content must be text.");
    if (Buffer.byteLength(content, "utf8") > 2 * 1024 * 1024) throw new Error("Files larger than 2 MB cannot be edited.");
    if (content.slice(0, 8192).includes("\0")) throw new Error("Binary files cannot be edited.");

    const context = await getTaskContext(workspaceId, taskId);
    const scoped = resolveLogicalWorkspacePath(context.workspace, filePath);
    const root = context.roots[scoped.folderIndex];
    const overlayPath = path.join(root.overlayPath, scoped.relativePath);
    const logicalSourcePath = overlayMountManager.logicalPath(scoped.sourcePath);
    const target = {
      sourcePath: logicalSourcePath,
      projectPath: scoped.sourcePath,
      overlayPath,
      basePath: path.join(root.basePath, scoped.relativePath),
      relativePath: scoped.relativePath,
    };
    await synchronizeOverlayTarget(target);
    const markerPath = `${overlayPath}${deletionMarkerSuffix}`;
    const sourceExists = existsSync(logicalSourcePath) && statSync(logicalSourcePath).isFile();
    const overlayExists = existsSync(overlayPath) && statSync(overlayPath).isFile();
    if (existsSync(markerPath)) throw new Error("Deleted files cannot be edited.");
    if (!sourceExists && !overlayExists) throw new Error("File does not exist.");
    await ensureBaseSnapshot(target);
    await clearConflict(target);

    await mkdir(path.dirname(overlayPath), { recursive: true });
    const output = Buffer.from(content, "utf8");
    if (sourceExists && (await readFile(logicalSourcePath)).equals(output)) {
      await clearOverlayState(target);
    } else {
      await writeFile(overlayPath, output);
    }
    await overlayMountManager.sync();
  }),
);

router.handle(IPC.workspace.restoreFile, (_event, { workspaceId, path: filePath, taskId }) =>
  queueWorkspaceWrite(async () => {
    const context = await getTaskContext(workspaceId, taskId);
    const scoped = resolveLogicalWorkspacePath(context.workspace, filePath);
    const root = context.roots[scoped.folderIndex];
    const logicalSourcePath = overlayMountManager.logicalPath(scoped.sourcePath);
    const target = {
      sourcePath: logicalSourcePath,
      projectPath: scoped.sourcePath,
      overlayPath: path.join(root.overlayPath, scoped.relativePath),
      basePath: path.join(root.basePath, scoped.relativePath),
      relativePath: scoped.relativePath,
    };
    const markerPath = `${target.overlayPath}${deletionMarkerSuffix}`;
    if (!existsSync(markerPath)) throw new Error("File is not deleted in this task.");
    await clearOverlayState(target);
    await overlayMountManager.sync();
  }),
);

router.handle(IPC.workspace.resolveConflict, (_event, { workspaceId, path: filePath, taskId, content, revision }) =>
  queueWorkspaceWrite(async () => {
    if (typeof content !== "string" || typeof revision !== "string") throw new Error("Invalid merge result.");
    if (Buffer.byteLength(content, "utf8") > 2 * 1024 * 1024) throw new Error("Files larger than 2 MB cannot be edited.");
    const context = await getTaskContext(workspaceId, taskId);
    const scoped = resolveLogicalWorkspacePath(context.workspace, filePath);
    const root = context.roots[scoped.folderIndex];
    await resolveOverlayConflict({
      sourcePath: overlayMountManager.logicalPath(scoped.sourcePath),
      projectPath: scoped.sourcePath,
      overlayPath: path.join(root.overlayPath, scoped.relativePath),
      basePath: path.join(root.basePath, scoped.relativePath),
      relativePath: scoped.relativePath,
    }, content, revision);
    await overlayMountManager.sync();
  }),
);
}
