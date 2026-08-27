import { randomUUID } from "node:crypto";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { isPathInside } from "../shared/paths.mjs";

function taskIssue(changes) {
  if (changes.unmappedPaths.length > 0) {
    return `Unmapped overlay entries: ${changes.unmappedPaths.join(", ")}`;
  }

  const conflicts = changes.operations
    .filter((operation) => operation.conflict)
    .map((operation) => operation.relativePath);

  return conflicts.length > 0 ? `Merge conflicts: ${conflicts.join(", ")}` : undefined;
}

function assertCompletable(changes) {
  if (changes.unmappedPaths.length > 0) {
    throw new Error("Resolve unmapped overlay entries before completing this task.");
  }
  if (changes.operations.some((operation) => operation.conflict)) {
    throw new Error("Resolve merge conflicts before completing this task.");
  }
}

export function createTaskUseCases({ workspaceStore, taskService, chatService }) {
  const { taskDataPath, taskSessionPath, ensureTaskData } = workspaceStore;
  const {
    overlayMountManager,
    getTaskContext,
    ensureTaskOverlay,
    taskOverlayOperations,
    commitTaskOverlay,
    finishMountedTaskOverlay,
    removeTaskData,
    removeTaskOverlay,
  } = taskService;

  async function mountTask({ workspaceId, taskId }) {
    const { workspace, task, roots } = await getTaskContext(workspaceId, taskId);
    const pending = await taskOverlayOperations(workspace, task);
    if (pending.unmappedPaths.length > 0) {
      throw new Error(
        `Unmapped overlay entries must be assigned to a project root: ${pending.unmappedPaths.join(", ")}`,
      );
    }
    if (pending.operations.some((operation) => operation.conflict)) {
      throw new Error("Resolve merge conflicts before mounting this task.");
    }

    const mountedTask = overlayMountManager.current();
    const anotherTaskIsMounted = mountedTask && (
      mountedTask.workspaceId !== workspaceId || mountedTask.taskId !== taskId
    );
    if (anotherTaskIsMounted) {
      await overlayMountManager.unmount(mountedTask.workspaceId, mountedTask.taskId);
    }

    await overlayMountManager.mount({
      workspaceId,
      taskId,
      taskName: task.name,
      roots: roots.map((root) => root.sourcePath),
      overlayRoots: roots.map((root) => root.overlayPath),
      operations: pending.operations,
    });
    await overlayMountManager.sync();
    return { mounted: true };
  }

  async function unmountTask({ workspaceId, taskId }) {
    await getTaskContext(workspaceId, taskId);
    await overlayMountManager.unmount(workspaceId, taskId);
    return { mounted: false };
  }

  async function getTaskStatus({ workspaceId, taskId }) {
    const { workspace, task } = await getTaskContext(workspaceId, taskId);
    const changes = await taskOverlayOperations(workspace, task);
    const mountedTask = overlayMountManager.current();
    const isMounted = mountedTask?.workspaceId === workspaceId && mountedTask?.taskId === taskId;

    return {
      hasChanges: changes.operations.length > 0 || changes.unmappedPaths.length > 0,
      changeCount: changes.operations.length + changes.unmappedPaths.length,
      issue: taskIssue(changes),
      mounted: isMounted,
      mountedTask: mountedTask && !isMounted ? mountedTask : undefined,
    };
  }

  async function completeTask({ workspaceId, taskId, options }) {
    let context = await getTaskContext(workspaceId, taskId);
    let pending = await taskOverlayOperations(context.workspace, context.task);
    assertCompletable(pending);

    const archive = options.archive;
    const requestedName = archive ? "" : options.name?.trim() ?? "";
    const mountedTask = overlayMountManager.current();
    const isMounted = mountedTask?.workspaceId === workspaceId && mountedTask?.taskId === taskId;

    if (mountedTask && !isMounted && pending.operations.length > 0) {
      await overlayMountManager.unmount(mountedTask.workspaceId, mountedTask.taskId);
      context = await getTaskContext(workspaceId, taskId);
      pending = await taskOverlayOperations(context.workspace, context.task);
      assertCompletable(pending);
    }

    if (isMounted) {
      await finishMountedTaskOverlay(context.workspace, context.task);
    } else if (pending.operations.length > 0) {
      await commitTaskOverlay(context.workspace, context.task);
    }
    if (archive) await removeTaskOverlay(workspaceId, taskId);

    let finalName = context.task.name;
    await workspaceStore.updateTask(workspaceId, taskId, (task, workspace) => {
      if (requestedName) task.name = requestedName;
      finalName = task.name;
      const now = new Date().toISOString();
      if (archive) task.completedAt = now;
      else delete task.completedAt;
      task.updatedAt = now;
      workspace.updatedAt = now;
    });
    return { archived: archive, name: finalName };
  }

  async function branchTask({ workspaceId, taskId }) {
    return workspaceStore.updateTask(workspaceId, taskId, async (source, workspace) => {
      if (source.completedAt) throw new Error("Unknown active task.");

      const now = new Date().toISOString();
      const branch = {
        ...source,
        id: randomUUID(),
        name: `${source.name.slice(0, 191)} (branch)`,
        chats: source.chats.map((chat) => ({ ...chat, id: randomUUID() })),
        completionSeen: false,
        createdAt: now,
        updatedAt: now,
      };
      const sourceData = taskDataPath(workspace, source);
      const branchData = taskDataPath(workspace, branch);
      await ensureTaskData(workspace, source);
      await mkdir(path.dirname(branchData), { recursive: true });
      await cp(sourceData, branchData, { recursive: true, errorOnExist: true });

      const sourceSessions = path.resolve(taskSessionPath(workspace, source));
      const branchSessions = path.resolve(taskSessionPath(workspace, branch));
      branch.chats = branch.chats.map((chat, index) => {
        const sourceSession = source.chats[index]?.sessionFile;
        if (typeof sourceSession !== "string") return chat;
        if (!isPathInside(sourceSessions, sourceSession)) {
          delete chat.sessionFile;
        } else {
          const relativePath = path.relative(sourceSessions, path.resolve(sourceSession));
          chat.sessionFile = path.join(branchSessions, relativePath);
        }
        return chat;
      });
      workspace.tasks.push(branch);
      workspace.updatedAt = now;
      await ensureTaskOverlay(workspace, branch);
      return branch;
    });
  }

  async function removeTask({ workspaceId, taskId, ownerId }) {
    await workspaceStore.requireTask(workspaceId, taskId);
    chatService.closeForTask(workspaceId, taskId, ownerId);

    const mountedTask = overlayMountManager.current();
    if (mountedTask?.workspaceId === workspaceId && mountedTask?.taskId === taskId) {
      await overlayMountManager.unmount(workspaceId, taskId);
    }
    await workspaceStore.updateTask(workspaceId, taskId, (_task, workspace) => {
      workspace.tasks = workspace.tasks.filter((task) => task.id !== taskId);
      workspace.updatedAt = new Date().toISOString();
    });
    await removeTaskData(workspaceId, taskId);
  }

  return {
    mountTask,
    unmountTask,
    getTaskStatus,
    completeTask,
    branchTask,
    removeTask,
  };
}

