import { createDocumentStore } from "./store.mjs";
import { IPC } from "../ipc/contracts.mjs";
import { resolveIpcRouter } from "../ipc/router.mjs";

export function registerDocumentIpc({ ipc, ipcMain, workspaceStore }) {
  const router = resolveIpcRouter({ ipc, ipcMain });

  async function documentsFor(workspaceId, taskId) {
    const workspace = await workspaceStore.requireWorkspace(workspaceId);
    const task = taskId ? workspaceStore.requireTaskFrom(workspace, taskId) : undefined;
    return createDocumentStore({
      workspaceRoot: workspaceStore.workspacePath(workspace),
      taskId: task?.id,
    });
  }

  router.handle(IPC.documents.list, async (_event, { workspaceId, taskId, scope }) => {
    const documents = await documentsFor(workspaceId, taskId);
    return documents.list(scope);
  });

  router.handle(IPC.documents.read, async (_event, { workspaceId, taskId, scope, path }) => {
    const documents = await documentsFor(workspaceId, taskId);
    return documents.read(scope, path);
  });

  router.handle(IPC.documents.write, (_event, { workspaceId, taskId, scope, path, content }) =>
    workspaceStore.queueWrite(async () => {
      const documents = await documentsFor(workspaceId, taskId);
      await documents.write(scope, path, content);
    }),
  );
}
