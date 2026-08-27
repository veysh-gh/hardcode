import path from "node:path";
import { IPC } from "./ipc/contracts.mjs";
import { resolveIpcRouter } from "./ipc/router.mjs";

export function createMainWindow({ BrowserWindow, currentDir, projectRoot, isDev, onClosed }) {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#0b0c10",
    frame: false,
    webPreferences: {
      preload: path.join(currentDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) window.loadURL("http://localhost:5173");
  else window.loadFile(path.join(projectRoot, "dist", "index.html"));

  const ownerId = window.webContents.id;
  window.on("closed", () => onClosed(ownerId));
  return window;
}

export function registerWindowIpc({ ipc, ipcMain, BrowserWindow }) {
  const router = resolveIpcRouter({ ipc, ipcMain });

  router.handle(IPC.window.minimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  router.handle(IPC.window.toggleMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });

  router.handle(IPC.window.close, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}
