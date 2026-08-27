function isMainFrameSender(event) {
  return Boolean(
    event?.sender &&
    event?.senderFrame &&
    event.sender.mainFrame &&
    event.senderFrame === event.sender.mainFrame,
  );
}

export function createIpcRouter({ ipcMain, isTrustedSender = isMainFrameSender }) {
  if (!ipcMain?.handle) throw new Error("An Electron ipcMain instance is required.");

  return {
    isHardcodeIpcRouter: true,
    handle(contract, handler) {
      ipcMain.handle(contract.channel, async (event, ...args) => {
        if (!isTrustedSender(event)) throw new Error("Untrusted IPC sender.");
        const request = contract.parse(args);
        return handler(event, request);
      });
    },
  };
}

export function resolveIpcRouter({ ipc, ipcMain }) {
  if (ipc?.isHardcodeIpcRouter) return ipc;
  return createIpcRouter({ ipcMain: ipcMain ?? ipc });
}
