import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function createWorkspaceStore(userDataPath) {
  const storePath = path.join(userDataPath, "workspaces.json");
  const dataPath = path.join(userDataPath, "workspaces");
  let writeQueue = Promise.resolve();

  async function read() {
    try {
      const parsed = JSON.parse(await readFile(storePath, "utf8"));
      if (
        !parsed ||
        !Array.isArray(parsed.workspaces) ||
        !parsed.workspaces.every((workspace) => workspace && Array.isArray(workspace.tasks))
      ) {
        throw new Error("Invalid workspace store.");
      }
      return { workspaces: parsed.workspaces };
    } catch (error) {
      if (error?.code === "ENOENT") return { workspaces: [] };
      throw new Error(`Could not read workspace store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function write(store) {
    const temporaryPath = `${storePath}.${process.pid}.tmp`;
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(temporaryPath, storePath);
  }

  function queueWrite(operation) {
    const result = writeQueue.then(operation, operation);
    writeQueue = result.catch(() => {});
    return result;
  }

  function validateInput(input) {
    const name = typeof input?.name === "string" ? input.name.trim() : "";
    if (!name) throw new Error("Workspace name is required.");

    const folders = Array.isArray(input?.folders)
      ? input.folders.map((folder) => ({
          path: typeof folder?.path === "string" ? path.resolve(folder.path) : "",
          defaultBranch:
            typeof folder?.defaultBranch === "string" && folder.defaultBranch.trim()
              ? folder.defaultBranch.trim()
              : "main",
        }))
      : [];
    if (folders.length === 0) throw new Error("Add at least one folder.");

    for (const folder of folders) {
      if (!path.isAbsolute(folder.path) || !existsSync(folder.path) || !statSync(folder.path).isDirectory()) {
        throw new Error(`Workspace folder does not exist: ${folder.path}`);
      }
    }
    return { name, folders };
  }

  function validateTasks(tasks) {
    if (!Array.isArray(tasks)) throw new Error("Invalid tasks.");
    return tasks.map((task) => {
      const id = typeof task?.id === "string" ? task.id : "";
      const name = typeof task?.name === "string" ? task.name.trim() : "";
      if (!/^[A-Za-z0-9_-]+$/.test(id) || !name || name.length > 200) {
        throw new Error("Every task needs a valid id and name.");
      }
      const chats = Array.isArray(task.chats)
        ? task.chats.map((chat) => {
            if (typeof chat?.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(chat.id)) {
              throw new Error("Invalid task chat.");
            }
            return {
              id: chat.id,
              ...(typeof chat.sessionFile === "string" && chat.sessionFile ? { sessionFile: chat.sessionFile } : {}),
              hasActivity: Boolean(chat.hasActivity),
            };
          })
        : [];
      return {
        id,
        name,
        chats,
        selectedFilePath: typeof task.selectedFilePath === "string" ? task.selectedFilePath : "",
        readPaths: Array.isArray(task.readPaths)
          ? [...new Set(task.readPaths.filter((entry) => typeof entry === "string" && path.isAbsolute(entry)))]
          : [],
        completionSeen: Boolean(task.completionSeen),
        ...(typeof task.completedAt === "string" ? { completedAt: task.completedAt } : {}),
        createdAt: typeof task.createdAt === "string" ? task.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });
  }

  function requireWorkspaceFrom(store, workspaceId) {
    if (typeof workspaceId !== "string") throw new Error("Invalid workspace id.");
    const workspace = store.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) throw new Error("Unknown workspace.");
    return workspace;
  }

  function requireTaskFrom(workspace, taskId) {
    if (typeof taskId !== "string") throw new Error("Invalid task id.");
    const task = workspace.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error("Unknown task.");
    return task;
  }

  async function requireWorkspace(workspaceId) {
    return requireWorkspaceFrom(await read(), workspaceId);
  }

  async function requireTask(workspaceId, taskId) {
    const workspace = await requireWorkspace(workspaceId);
    return { workspace, task: requireTaskFrom(workspace, taskId) };
  }

  function update(operation) {
    return queueWrite(async () => {
      const store = await read();
      const result = await operation(store);
      await write(store);
      return result;
    });
  }

  function updateWorkspace(workspaceId, operation) {
    return update((store) => operation(requireWorkspaceFrom(store, workspaceId), store));
  }

  function updateTask(workspaceId, taskId, operation) {
    return updateWorkspace(workspaceId, (workspace, store) =>
      operation(requireTaskFrom(workspace, taskId), workspace, store),
    );
  }

  const workspacePath = (workspace) => path.join(dataPath, workspace.id);
  const taskDataPath = (workspace, task) => path.join(workspacePath(workspace), "tasks", task.id);
  const taskOverlayPath = (workspace, task) => path.join(taskDataPath(workspace, task), "overlays");
  const taskSessionPath = (workspace, task) => path.join(taskDataPath(workspace, task), "sessions");
  const taskDocumentsPath = (workspace, task) => path.join(taskDataPath(workspace, task), "documents");

  async function ensureWorkspaceData(workspace) {
    await Promise.all([
      mkdir(path.join(workspacePath(workspace), "documents", "notes"), { recursive: true }),
      mkdir(path.join(workspacePath(workspace), "documents", "memory"), { recursive: true }),
    ]);
  }

  async function ensureTaskData(workspace, task) {
    await ensureWorkspaceData(workspace);
    await Promise.all([
      mkdir(taskSessionPath(workspace, task), { recursive: true }),
      mkdir(path.join(taskDocumentsPath(workspace, task), "notes"), { recursive: true }),
      mkdir(path.join(taskDocumentsPath(workspace, task), "memory"), { recursive: true }),
    ]);
  }

  return {
    storePath,
    dataPath,
    read,
    write,
    queueWrite,
    validateInput,
    validateTasks,
    requireTaskFrom,
    requireWorkspace,
    requireTask,
    update,
    updateWorkspace,
    updateTask,
    workspacePath,
    taskDataPath,
    taskOverlayPath,
    taskSessionPath,
    taskDocumentsPath,
    ensureWorkspaceData,
    ensureTaskData,
  };
}
