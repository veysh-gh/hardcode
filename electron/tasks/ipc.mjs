import { IPC } from "../ipc/contracts.mjs";
import { resolveIpcRouter } from "../ipc/router.mjs";
import { createTaskUseCases } from "./use-cases.mjs";

export function registerTaskIpc({
  ipc,
  ipcMain,
  taskUseCases,
  workspaceStore,
  taskService,
  chatService,
}) {
  const router = resolveIpcRouter({ ipc, ipcMain });
  const useCases = taskUseCases ?? createTaskUseCases({ workspaceStore, taskService, chatService });

  router.handle(IPC.task.mount, (_event, request) => useCases.mountTask(request));
  router.handle(IPC.task.unmount, (_event, request) => useCases.unmountTask(request));
  router.handle(IPC.task.status, (_event, request) => useCases.getTaskStatus(request));
  router.handle(IPC.task.complete, (_event, request) => useCases.completeTask(request));
  router.handle(IPC.task.branch, (_event, request) => useCases.branchTask(request));
  router.handle(IPC.task.remove, (event, request) =>
    useCases.removeTask({ ...request, ownerId: event.sender.id }),
  );
}
