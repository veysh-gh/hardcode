import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { IPC } from "../ipc/contracts.mjs";
import { resolveIpcRouter } from "../ipc/router.mjs";

export function registerChatIpc({ ipc, ipcMain, shell, api }) {
const router = resolveIpcRouter({ ipc, ipcMain });
const {
  createChatSession,
  toIpcSafe,
  historyEntries,
  historyPage,
  getChatCommands,
  requireChat,
  getChatCompletions,
  handleChatInput,
  sendChatEvent,
  closeChat,
  respondInteraction,
  taskSessionPath,
} = api;

router.handle(IPC.chat.start, async (
  event,
  { chatId, workspaceId, taskId, sessionFile },
) => {
  const chat = await createChatSession(event, chatId, workspaceId, taskId, sessionFile);
  return toIpcSafe({
    chatId,
    sessionFile: chat.session.sessionFile,
    ...historyPage(chat.session.messages),
    ready: true,
    model: chat.session.model && chat.session.model.provider !== "unknown"
      ? {
          provider: chat.session.model.provider,
          id: chat.session.model.id,
          name: chat.session.model.name,
        }
      : null,
    commands: getChatCommands(chat.session),
  });
});

router.handle(IPC.chat.history, async (event, { chatId, before }) => {
  const chat = requireChat(event, chatId);
  return toIpcSafe(historyPage(chat.session.messages, before));
});

router.handle(IPC.chat.complete, async (event, { chatId, command, argumentPrefix }) => {
  const chat = requireChat(event, chatId);
  return getChatCompletions(chat, command, argumentPrefix);
});

router.handle(IPC.chat.send, async (event, { chatId, message }) => {
  const chat = requireChat(event, chatId);
  void handleChatInput(chat, message).catch((error) => {
    sendChatEvent(chat, { type: "state", running: false });
    sendChatEvent(chat, {
      type: "error",
      content: error instanceof Error ? error.message : String(error),
    });
  });
  return { accepted: true };
});

router.handle(IPC.chat.abort, async (event, { chatId }) => {
  const chat = requireChat(event, chatId);
  chat.operationAbort?.abort();
  await chat.session.abort();
});

router.handle(IPC.chat.branch, async (event, { chatId, newChatId }) => {
  const chat = requireChat(event, chatId);
  const task = chat.task;
  const sessionManager = chat.session.sessionManager;
  const header = sessionManager.getHeader();
  const entries = sessionManager.getEntries();
  if (!header || entries.length === 0) throw new Error("This chat has no session history to branch.");

  const sessionDirectory = taskSessionPath(chat.workspace, task);
  const targetSession = path.join(sessionDirectory, `${newChatId}.jsonl`);
  const sourceSession = chat.session.sessionFile;
  const branchHeader = {
    ...header,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    cwd: sessionManager.getCwd(),
    ...(typeof sourceSession === "string" ? { parentSession: sourceSession } : {}),
  };
  await writeFile(
    targetSession,
    `${[branchHeader, ...entries].map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return { sessionFile: targetSession, entries: historyEntries(chat.session.messages) };
});

router.handle(IPC.chat.close, (event, { chatId }) => closeChat(chatId, event.sender.id));

router.handle(IPC.chat.respond, (event, { chatId, interactionId, response }) => {
  respondInteraction(chatId, event.sender.id, interactionId, response);
});

router.handle(IPC.chat.openExternal, async (_event, { url }) => {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Only HTTP links can be opened.");
  }
  await shell.openExternal(parsed.href);
});
}
