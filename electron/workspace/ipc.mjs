import { randomUUID } from "node:crypto";
import { registerWorkspaceFileIpc } from "./files.mjs";
import { IPC } from "../ipc/contracts.mjs";
import { resolveIpcRouter } from "../ipc/router.mjs";

export function registerWorkspaceIpc({
  ipc,
  ipcMain,
  BrowserWindow,
  dialog,
  getMainWindow,
  workspaceStore,
  taskService,
}) {
  const router = resolveIpcRouter({ ipc, ipcMain });
  const mainWindow = () => getMainWindow();

  router.handle(IPC.workspace.list, async () => {
    const store = await workspaceStore.read();
    void Promise.allSettled(
      store.workspaces.flatMap((workspace) =>
        workspace.tasks
          .filter((task) => task.completedAt)
          .map((task) => taskService.removeTaskOverlay(workspace.id, task.id)),
      ),
    );
    return store.workspaces;
  });

  router.handle(IPC.workspace.pickFolders, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow();
    const result = await dialog.showOpenDialog(owner, {
      title: "Add workspace folders",
      properties: ["openDirectory", "multiSelections"],
    });
    return result.canceled ? [] : result.filePaths;
  });

  router.handle(IPC.workspace.create, async (_event, { input }) => {
    const validated = workspaceStore.validateInput(input);
    const now = new Date().toISOString();
    const workspace = {
      id: randomUUID(),
      ...validated,
      tasks: [],
      createdAt: now,
      updatedAt: now,
    };
    await workspaceStore.update((store) => store.workspaces.push(workspace));
    await workspaceStore.ensureWorkspaceData(workspace);
    return workspace;
  });

  router.handle(IPC.workspace.saveTasks, (_event, { workspaceId, tasks }) =>
    workspaceStore.updateWorkspace(workspaceId, async (workspace) => {
      const completedTasks = workspace.tasks.filter((task) => task.completedAt);
      const activeTasks = workspaceStore.validateTasks(tasks).filter(
        (task) => !completedTasks.some((completed) => completed.id === task.id),
      );
      workspace.tasks = [...activeTasks, ...completedTasks];
      workspace.updatedAt = new Date().toISOString();
      await Promise.all(workspace.tasks.map((task) => workspaceStore.ensureTaskData(workspace, task)));
      return workspace.tasks;
    }),
  );

  registerWorkspaceFileIpc({ ipc: router, workspaceStore, taskService });
}
