const { contextBridge, ipcRenderer } = require("electron");

// Sandboxed Electron preloads cannot import the ESM contract module. Keep this
// transport-only channel map aligned with electron/ipc/contracts.mjs until the
// preload is built from TypeScript into a bundled CJS artifact.
const channels = Object.freeze({
  workspace: {
    list: "workspace:list",
    pickFolders: "workspace:pick-folders",
    create: "workspace:create",
    saveTasks: "workspace:save-tasks",
    readDirectory: "workspace:read-directory",
    readFile: "workspace:read-file",
    writeFile: "workspace:write-file",
    restoreFile: "workspace:restore-file",
    resolveConflict: "workspace:resolve-conflict",
  },
  git: {
    status: "git:status",
    updateIndex: "git:update-index",
    commit: "git:commit",
  },
  documents: {
    list: "documents:list",
    read: "documents:read",
    write: "documents:write",
  },
  task: {
    status: "task:status",
    mount: "task:mount",
    unmount: "task:unmount",
    complete: "task:complete",
    remove: "task:remove",
    branch: "task:branch",
  },
  window: {
    minimize: "window:minimize",
    toggleMaximize: "window:toggle-maximize",
    close: "window:close",
  },
  chat: {
    start: "chat:start",
    send: "chat:send",
    complete: "chat:complete",
    abort: "chat:abort",
    close: "chat:close",
    branch: "chat:branch",
    respond: "chat:interaction-response",
    openExternal: "chat:open-external",
    event: "chat:event",
    interaction: "chat:interaction",
    interactionClear: "chat:interaction-clear",
  },
});

contextBridge.exposeInMainWorld("hardcode", {
  workspace: {
    list: () => ipcRenderer.invoke(channels.workspace.list),
    pickFolders: () => ipcRenderer.invoke(channels.workspace.pickFolders),
    create: (input) => ipcRenderer.invoke(channels.workspace.create, { input }),
    saveTasks: (workspaceId, tasks) =>
      ipcRenderer.invoke(channels.workspace.saveTasks, { workspaceId, tasks }),
    readDirectory: (workspaceId, directoryPath, taskId, diffMode) =>
      ipcRenderer.invoke(channels.workspace.readDirectory, {
        workspaceId,
        path: directoryPath,
        taskId,
        diffMode,
      }),
    readFile: (workspaceId, filePath, taskId, diffMode) =>
      ipcRenderer.invoke(channels.workspace.readFile, { workspaceId, path: filePath, taskId, diffMode }),
    writeFile: (workspaceId, filePath, taskId, content) =>
      ipcRenderer.invoke(channels.workspace.writeFile, { workspaceId, path: filePath, taskId, content }),
    restoreFile: (workspaceId, filePath, taskId) =>
      ipcRenderer.invoke(channels.workspace.restoreFile, { workspaceId, path: filePath, taskId }),
    resolveConflict: (workspaceId, filePath, taskId, content, revision) =>
      ipcRenderer.invoke(channels.workspace.resolveConflict, {
        workspaceId,
        path: filePath,
        taskId,
        content,
        revision,
      }),
  },
  git: {
    status: (workspaceId) => ipcRenderer.invoke(channels.git.status, { workspaceId }),
    updateIndex: (workspaceId, repositoryRoot, action, filePath) =>
      ipcRenderer.invoke(channels.git.updateIndex, { workspaceId, repositoryRoot, action, filePath }),
    commit: (workspaceId, repositoryRoot, message) =>
      ipcRenderer.invoke(channels.git.commit, { workspaceId, repositoryRoot, message }),
  },
  documents: {
    list: (workspaceId, taskId, scope) =>
      ipcRenderer.invoke(channels.documents.list, { workspaceId, taskId, scope }),
    read: (workspaceId, taskId, scope, documentPath) =>
      ipcRenderer.invoke(channels.documents.read, { workspaceId, taskId, scope, path: documentPath }),
    write: (workspaceId, taskId, scope, documentPath, content) =>
      ipcRenderer.invoke(channels.documents.write, {
        workspaceId,
        taskId,
        scope,
        path: documentPath,
        content,
      }),
  },
  task: {
    status: (workspaceId, taskId) => ipcRenderer.invoke(channels.task.status, { workspaceId, taskId }),
    mount: (workspaceId, taskId) => ipcRenderer.invoke(channels.task.mount, { workspaceId, taskId }),
    unmount: (workspaceId, taskId) => ipcRenderer.invoke(channels.task.unmount, { workspaceId, taskId }),
    complete: (workspaceId, taskId, options) =>
      ipcRenderer.invoke(channels.task.complete, { workspaceId, taskId, options }),
    remove: (workspaceId, taskId) => ipcRenderer.invoke(channels.task.remove, { workspaceId, taskId }),
    branch: (workspaceId, taskId) => ipcRenderer.invoke(channels.task.branch, { workspaceId, taskId }),
  },
  window: {
    minimize: () => ipcRenderer.invoke(channels.window.minimize),
    toggleMaximize: () => ipcRenderer.invoke(channels.window.toggleMaximize),
    close: () => ipcRenderer.invoke(channels.window.close),
  },
  chat: {
    start: (chatId, workspaceId, taskId, sessionFile) =>
      ipcRenderer.invoke(channels.chat.start, { chatId, workspaceId, taskId, sessionFile }),
    send: (chatId, message) => ipcRenderer.invoke(channels.chat.send, { chatId, message }),
    complete: (chatId, command, argumentPrefix) =>
      ipcRenderer.invoke(channels.chat.complete, { chatId, command, argumentPrefix }),
    abort: (chatId) => ipcRenderer.invoke(channels.chat.abort, { chatId }),
    close: (chatId) => ipcRenderer.invoke(channels.chat.close, { chatId }),
    branch: (chatId, newChatId) => ipcRenderer.invoke(channels.chat.branch, { chatId, newChatId }),
    respond: (chatId, interactionId, response) =>
      ipcRenderer.invoke(channels.chat.respond, { chatId, interactionId, response }),
    openExternal: (url) => ipcRenderer.invoke(channels.chat.openExternal, { url }),
    onEvent: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on(channels.chat.event, handler);
      return () => ipcRenderer.removeListener(channels.chat.event, handler);
    },
    onInteraction: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on(channels.chat.interaction, handler);
      return () => ipcRenderer.removeListener(channels.chat.interaction, handler);
    },
    onInteractionClear: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on(channels.chat.interactionClear, handler);
      return () => ipcRenderer.removeListener(channels.chat.interactionClear, handler);
    },
  },
});
