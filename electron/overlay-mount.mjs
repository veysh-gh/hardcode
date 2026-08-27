import { existsSync, lstatSync, statSync, watch } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isPathInside } from "./shared/paths.mjs";

function safeRelative(value) {
  const relative = path.normalize(value);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Unsafe mounted path: ${value}`);
  }
  return relative;
}

function pathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function filesEqual(leftPath, rightPath) {
  if (!existsSync(leftPath) || !existsSync(rightPath)) return false;
  const [left, right] = await Promise.all([readFile(leftPath), readFile(rightPath)]);
  return left.equals(right);
}

export function createOverlayMountManager({ storagePath, getOperations }) {
  const statePath = path.join(storagePath, "mount.json");
  const backupRoot = path.join(storagePath, "originals");
  let state;
  let initialized;
  let operationQueue = Promise.resolve();
  let overlayWatchers = [];
  let sourceWatchers = new Map();
  let syncTimer;

  const enqueue = (operation) => {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.catch(() => {});
    return result;
  };

  const persist = async () => {
    await mkdir(storagePath, { recursive: true });
    const temporaryPath = `${statePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporaryPath, statePath);
  };

  const stopWatchers = () => {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = undefined;
    for (const watcher of overlayWatchers) watcher.close();
    overlayWatchers = [];
    for (const watcher of sourceWatchers.values()) watcher.close();
    sourceWatchers = new Map();
  };

  const scheduleSync = () => {
    if (!state || state.phase === "unmounting" || state.phase === "finalizing" || syncTimer) return;
    syncTimer = setTimeout(() => {
      syncTimer = undefined;
      void api.sync().catch(() => {});
    }, 35);
  };

  const watchDirectory = (directory) => {
    const key = pathKey(directory);
    if (sourceWatchers.has(key) || !existsSync(directory)) return;
    try {
      sourceWatchers.set(key, watch(directory, () => scheduleSync()));
    } catch {
      // A deleted or inaccessible directory is still restored correctly on
      // explicit sync/unmount; its watcher can be recreated on the next sync.
    }
  };

  const startWatchers = () => {
    stopWatchers();
    if (!state) return;
    for (const overlayRoot of state.overlayRoots) {
      if (!existsSync(overlayRoot)) continue;
      try {
        overlayWatchers.push(watch(overlayRoot, { recursive: true }, () => scheduleSync()));
      } catch {
        // Explicit mutations also request an immediate sync.
      }
    }
    for (const entry of state.entries) watchDirectory(path.dirname(entry.projectPath));
  };

  const initialize = async () => {
    if (initialized) return initialized;
    initialized = (async () => {
      try {
        const parsed = JSON.parse(await readFile(statePath, "utf8"));
        if (
          typeof parsed?.workspaceId === "string" &&
          typeof parsed?.taskId === "string" &&
          ["mounting", "mounted", "unmounting", "finalizing"].includes(parsed?.phase) &&
          Array.isArray(parsed.roots) &&
          Array.isArray(parsed.overlayRoots) &&
          parsed.roots.every((root) => typeof root === "string" && path.isAbsolute(root)) &&
          parsed.overlayRoots.every((root) => typeof root === "string" && path.isAbsolute(root)) &&
          Array.isArray(parsed.entries)
        ) {
          const roots = parsed.roots.map((root) => path.resolve(root));
          const overlayRoots = parsed.overlayRoots.map((root) => path.resolve(root));
          state = {
            ...parsed,
            roots,
            overlayRoots,
            entries: parsed.entries.flatMap((entry) => {
              if (!Number.isInteger(entry?.rootIndex) || !roots[entry.rootIndex] || typeof entry?.relativePath !== "string") return [];
              let relativePath;
              try { relativePath = safeRelative(entry.relativePath); } catch { return []; }
              const projectPath = path.resolve(roots[entry.rootIndex], relativePath);
              const rootRelative = path.relative(roots[entry.rootIndex], projectPath);
              if (rootRelative.startsWith("..") || path.isAbsolute(rootRelative)) return [];
              if (overlayRoots.some((overlayRoot) => isPathInside(overlayRoot, projectPath)) || isPathInside(storagePath, projectPath)) {
                return [];
              }
              return [{
                ...entry,
                relativePath,
                projectPath,
                backupPath: path.join(backupRoot, String(entry.rootIndex), relativePath),
                createdDirectories: Array.isArray(entry.createdDirectories)
                  ? entry.createdDirectories.map((directory) => path.resolve(directory)).filter((directory) => {
                      const relative = path.relative(roots[entry.rootIndex], directory);
                      return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
                    })
                  : [],
              }];
            }),
          };
          if (state.phase === "unmounting") {
            const { workspaceId, taskId } = state;
            setTimeout(() => void api.unmount(workspaceId, taskId).catch(() => {}), 0);
          } else if (state.phase === "finalizing") {
            const { workspaceId, taskId } = state;
            setTimeout(() => void api.finalize(workspaceId, taskId).catch(() => {}), 0);
          } else {
            startWatchers();
            scheduleSync();
          }
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw new Error(`Could not restore mounted task state: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    return initialized;
  };

  const entryForProjectPath = (projectPath) => {
    if (!state) return undefined;
    const key = pathKey(projectPath);
    return state.entries.find((entry) => pathKey(entry.projectPath) === key);
  };

  const snapshotOperation = async (operation) => {
    const root = state.roots[operation.rootIndex];
    if (!root) throw new Error("Mounted change refers to an unknown workspace root.");
    const relativePath = safeRelative(operation.relativePath);
    const projectPath = path.resolve(root, relativePath);
    if (state.overlayRoots.some((overlayRoot) => isPathInside(overlayRoot, projectPath)) || isPathInside(storagePath, projectPath)) {
      return undefined;
    }
    const existing = entryForProjectPath(projectPath);
    if (existing) return existing;

    const backupPath = path.join(backupRoot, String(operation.rootIndex), relativePath);
    const beforeExists = existsSync(projectPath);
    const beforeStats = beforeExists ? lstatSync(projectPath) : undefined;
    if (beforeStats && !beforeStats.isFile()) {
      throw new Error(`Mount supports files only: ${projectPath}`);
    }
    if (beforeExists) {
      await mkdir(path.dirname(backupPath), { recursive: true });
      await copyFile(projectPath, backupPath);
    }

    const createdDirectories = [];
    let directory = path.dirname(projectPath);
    const rootPath = path.resolve(root);
    while (pathKey(directory) !== pathKey(rootPath) && !existsSync(directory)) {
      createdDirectories.push(directory);
      directory = path.dirname(directory);
    }
    const entry = {
      rootIndex: operation.rootIndex,
      relativePath,
      projectPath,
      backupPath,
      beforeExists,
      beforeMode: beforeStats?.mode,
      createdDirectories,
    };
    state.entries.push(entry);
    await persist();
    watchDirectory(path.dirname(projectPath));
    return entry;
  };

  const restoreEntry = async (entry) => {
    if (entry.beforeExists) {
      await mkdir(path.dirname(entry.projectPath), { recursive: true });
      if (existsSync(entry.projectPath) && !lstatSync(entry.projectPath).isFile()) {
        await rm(entry.projectPath, { force: true });
      }
      if (!(await filesEqual(entry.backupPath, entry.projectPath))) await copyFile(entry.backupPath, entry.projectPath);
      if (Number.isInteger(entry.beforeMode)) await chmod(entry.projectPath, entry.beforeMode);
    } else if (existsSync(entry.projectPath)) {
      await rm(entry.projectPath, { force: true });
    }
  };

  const applyOperation = async (operation, entry) => {
    if (operation.type === "deleted") {
      if (existsSync(entry.projectPath)) await rm(entry.projectPath, { force: true });
      return true;
    }
    let overlayStats;
    try {
      overlayStats = statSync(operation.overlayPath);
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
    if (!overlayStats.isFile()) {
      return false;
    }
    if (existsSync(entry.projectPath) && !lstatSync(entry.projectPath).isFile()) {
      throw new Error(`Mounted destination is no longer a regular file: ${entry.projectPath}`);
    }
    await mkdir(path.dirname(entry.projectPath), { recursive: true });
    if (!(await filesEqual(operation.overlayPath, entry.projectPath))) {
      try {
        await copyFile(operation.overlayPath, entry.projectPath);
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    }
    return true;
  };

  const removeCreatedDirectories = async (entries) => {
    const directories = [...new Set(entries.flatMap((entry) => entry.createdDirectories ?? []))]
      .sort((left, right) => right.length - left.length);
    for (const directory of directories) {
      try { await rmdir(directory); } catch (error) {
        if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") throw error;
      }
    }
  };

  const api = {
    initialize,

    current() {
      if (!state) return undefined;
      return {
        workspaceId: state.workspaceId,
        taskId: state.taskId,
        taskName: state.taskName,
      };
    },

    logicalPath(projectPath) {
      const entry = entryForProjectPath(projectPath);
      return entry ? entry.backupPath : path.resolve(projectPath);
    },

    logicalExists(projectPath) {
      const entry = entryForProjectPath(projectPath);
      return entry ? Boolean(entry.beforeExists) : existsSync(projectPath);
    },

    logicalOverrides(rootPath) {
      if (!state) return [];
      const rootKey = pathKey(rootPath);
      return state.entries
        .filter((entry) => pathKey(state.roots[entry.rootIndex]) === rootKey)
        .map((entry) => ({
          projectPath: entry.projectPath,
          logicalPath: entry.backupPath,
          exists: Boolean(entry.beforeExists),
          relativePath: entry.relativePath,
        }));
    },

    adjustDirectoryEntries(directoryPath, entries) {
      if (!state) return entries;
      const adjusted = new Map(entries.map((entry) => [entry.name, entry]));
      const directoryKey = pathKey(directoryPath);
      for (const entry of state.entries) {
        if (pathKey(path.dirname(entry.projectPath)) !== directoryKey) continue;
        const name = path.basename(entry.projectPath);
        if (entry.beforeExists) adjusted.set(name, { name, type: "file" });
        else adjusted.delete(name);
      }
      for (const entry of state.entries) {
        for (const directory of entry.createdDirectories ?? []) {
          if (pathKey(path.dirname(directory)) === directoryKey) adjusted.delete(path.basename(directory));
        }
      }
      return [...adjusted.values()];
    },

    async mount({ workspaceId, taskId, taskName, roots, overlayRoots, operations }) {
      await initialize();
      return enqueue(async () => {
        if (state) {
          if (state.workspaceId === workspaceId && state.taskId === taskId) return api.current();
          throw new Error(`“${state.taskName || state.taskId}” is already mounted. Unmount it first.`);
        }
        state = {
          phase: "mounting",
          workspaceId,
          taskId,
          taskName,
          roots: roots.map((root) => path.resolve(root)),
          overlayRoots: overlayRoots.map((root) => path.resolve(root)),
          entries: [],
          mountedAt: new Date().toISOString(),
        };
        await rm(storagePath, { recursive: true, force: true });
        await persist();
        try {
          for (const operation of operations) {
            const entry = await snapshotOperation(operation);
            if (entry && !(await applyOperation(operation, entry))) await restoreEntry(entry);
          }
          state.phase = "mounted";
          await persist();
          startWatchers();
          return api.current();
        } catch (error) {
          for (const entry of [...state.entries].reverse()) await restoreEntry(entry);
          await removeCreatedDirectories(state.entries);
          state = undefined;
          await rm(storagePath, { recursive: true, force: true });
          throw error;
        }
      });
    },

    async sync() {
      await initialize();
      return enqueue(async () => {
        if (!state) return;
        const mounted = state;
        const result = await getOperations(mounted.workspaceId, mounted.taskId);
        if (result.unmappedPaths?.length) throw new Error("Mounted task contains unmapped overlay entries.");
        if (result.operations.some((operation) => operation.conflict)) {
          throw new Error("Mounted task contains unresolved merge conflicts.");
        }
        const current = new Map();
        for (const operation of result.operations) {
          const entry = await snapshotOperation(operation);
          if (!entry) continue;
          current.set(pathKey(entry.projectPath), { operation, entry });
        }
        for (const entry of mounted.entries) {
          const active = current.get(pathKey(entry.projectPath));
          if (active) {
            if (!(await applyOperation(active.operation, entry))) await restoreEntry(entry);
          }
          else await restoreEntry(entry);
        }
      });
    },

    async unmount(workspaceId, taskId) {
      await initialize();
      return enqueue(async () => {
        if (!state || state.workspaceId !== workspaceId || state.taskId !== taskId) {
          throw new Error("This task is not mounted.");
        }
        stopWatchers();
        const mounted = state;
        mounted.phase = "unmounting";
        await persist();
        for (const entry of [...mounted.entries].reverse()) await restoreEntry(entry);
        await removeCreatedDirectories(mounted.entries);
        state = undefined;
        await rm(storagePath, { recursive: true, force: true });
      });
    },

    async finalize(workspaceId, taskId) {
      await initialize();
      await api.sync();
      return enqueue(async () => {
        if (!state || state.workspaceId !== workspaceId || state.taskId !== taskId) {
          throw new Error("This task is not mounted.");
        }
        stopWatchers();
        state.phase = "finalizing";
        await persist();
        state = undefined;
        await rm(storagePath, { recursive: true, force: true });
      });
    },

    dispose() {
      stopWatchers();
    },
  };

  return api;
}
