import electron from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createWorkspaceStore } from "./workspace/store.mjs";
import { registerWorkspaceIpc } from "./workspace/ipc.mjs";
import { registerDocumentIpc } from "./documents/ipc.mjs";
import { registerGitIpc } from "./git/ipc.mjs";
import { offerWindowsWslSetup } from "./platform/windows-wsl.mjs";
import { createMainWindow, registerWindowIpc } from "./window.mjs";
import { createChatService } from "./chat/sessions.mjs";
import { createTaskService } from "./tasks/service.mjs";
import { registerTaskIpc } from "./tasks/ipc.mjs";
import { createTaskUseCases } from "./tasks/use-cases.mjs";
import { createIpcRouter } from "./ipc/router.mjs";

const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = electron;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..");
const workspaceStore = createWorkspaceStore(app.getPath("userData"));
const isDev = !app.isPackaged;
let mainWindow;

const ipc = createIpcRouter({
  ipcMain,
  isTrustedSender: (event) => Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame,
  ),
});

const taskService = createTaskService(workspaceStore);

function createWindow() {
  mainWindow = createMainWindow({ BrowserWindow, currentDir, projectRoot, isDev, onClosed: chatService.closeForOwner });
}

const chatService = createChatService({
  workspaceStore,
  taskService,
  shell,
});
const taskUseCases = createTaskUseCases({ workspaceStore, taskService, chatService });

registerDocumentIpc({ ipc, workspaceStore });
registerGitIpc({ ipc, workspaceStore, overlayMountManager: taskService.overlayMountManager });
registerWindowIpc({ ipc, BrowserWindow });
registerWorkspaceIpc({
  ipc,
  BrowserWindow,
  dialog,
  getMainWindow: () => mainWindow,
  workspaceStore,
  taskService,
});
registerTaskIpc({ ipc, taskUseCases });
chatService.registerIpc(ipc);

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  void offerWindowsWslSetup(dialog);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  chatService.closeAll();
  if (process.platform !== "darwin") app.quit();
});
