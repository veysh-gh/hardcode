import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createChatService } from "../../../electron/chat/sessions.mjs";
import { registerDocumentIpc } from "../../../electron/documents/ipc.mjs";
import { registerGitIpc } from "../../../electron/git/ipc.mjs";
import { registerTaskIpc } from "../../../electron/tasks/ipc.mjs";
import { createTaskService } from "../../../electron/tasks/service.mjs";
import { registerWindowIpc } from "../../../electron/window.mjs";
import { registerWorkspaceIpc } from "../../../electron/workspace/ipc.mjs";
import { createWorkspaceStore } from "../../../electron/workspace/store.mjs";

const EXPECTED_CHANNELS = [
  "chat:abort",
  "chat:branch",
  "chat:close",
  "chat:complete",
  "chat:interaction-response",
  "chat:open-external",
  "chat:send",
  "chat:start",
  "documents:list",
  "documents:read",
  "documents:write",
  "git:commit",
  "git:status",
  "git:update-index",
  "task:branch",
  "task:complete",
  "task:mount",
  "task:remove",
  "task:status",
  "task:unmount",
  "window:close",
  "window:minimize",
  "window:toggle-maximize",
  "workspace:create",
  "workspace:list",
  "workspace:pick-folders",
  "workspace:read-directory",
  "workspace:read-file",
  "workspace:resolve-conflict",
  "workspace:restore-file",
  "workspace:save-tasks",
  "workspace:write-file",
];

function createIpcRecorder() {
  const registeredChannels = [];

  return {
    ipcMain: {
      handle(channel) {
        assert.equal(
          registeredChannels.includes(channel),
          false,
          `IPC channel was registered twice: ${channel}`,
        );
        registeredChannels.push(channel);
      },
    },
    registeredChannels,
  };
}

test("registers every renderer IPC channel exactly once", () => {
  const { ipcMain, registeredChannels } = createIpcRecorder();
  const BrowserWindow = { fromWebContents: () => undefined };
  const workspaceStore = createWorkspaceStore(
    path.join(os.tmpdir(), "hardcode-ipc-registration"),
  );
  const taskService = createTaskService(workspaceStore);
  const chatService = createChatService({
    workspaceStore,
    taskService,
    shell: { openExternal: async () => {} },
  });

  // Register every IPC module the same way the Electron main process does.
  registerDocumentIpc({ ipcMain, workspaceStore });
  registerGitIpc({
    ipcMain,
    workspaceStore,
    overlayMountManager: taskService.overlayMountManager,
  });
  registerWindowIpc({ ipcMain, BrowserWindow });
  registerWorkspaceIpc({
    ipcMain,
    BrowserWindow,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    getMainWindow: () => undefined,
    workspaceStore,
    taskService,
  });
  registerTaskIpc({ ipcMain, workspaceStore, taskService, chatService });
  chatService.registerIpc(ipcMain);

  assert.deepEqual(registeredChannels.sort(), EXPECTED_CHANNELS.sort());
});
