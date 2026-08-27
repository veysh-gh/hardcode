import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createOverlayTooling } from "../overlay-tooling.mjs";
import { createDocumentTooling } from "../document-tooling.mjs";
import { isPathInside } from "../shared/paths.mjs";
import { registerChatIpc } from "./ipc.mjs";
import { createChatInteractions } from "./interactions.mjs";
import { IPC_EVENTS } from "../ipc/contracts.mjs";

export function createChatService({ workspaceStore, taskService, shell }) {
const { workspacePath, taskSessionPath } = workspaceStore;
const { ensureTaskOverlay, overlayMountManager } = taskService;
const piAgentDirectory = getAgentDir();
const chats = new Map();
const pendingInteractions = new Map();
let modelRuntimePromise;

const {
  sendInteraction,
  requestInteraction,
  clearInteraction,
  createExtensionUI,
} = createChatInteractions({ pendingInteractions, sendChatEvent, toIpcSafe });

function textContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

const HISTORY_PAGE_SIZE = 30;

function historyToolCalls(messages) {
  const toolCalls = new Map();
  for (const message of messages) {
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part?.type === "toolCall" && typeof part.id === "string") {
        toolCalls.set(part.id, { name: part.name, input: JSON.stringify(part.arguments ?? {}, null, 2) });
      }
    }
  }
  return toolCalls;
}

function historyEntry(message, index, toolCalls) {
  const id = `history-${index}`;
  if (message?.role === "user") {
    const content = textContent(message.content);
    return content ? { id, kind: "user", content } : null;
  }
  if (message?.role === "assistant") {
    const content = textContent(message.content);
    return content ? { id, kind: "assistant", content } : null;
  }
  if (message?.role === "toolResult") {
    const toolCall = toolCalls.get(message.toolCallId);
    return {
      id,
      kind: "tool",
      title: message.toolName || toolCall?.name || "Tool",
      input: toolCall?.input,
      content: textContent(message.content),
      status: message.isError ? "error" : "done",
    };
  }
  if (message?.role === "bashExecution") {
    return {
      id,
      kind: "tool",
      title: message.command || "Command",
      content: message.output || "",
      status: message.exitCode && message.exitCode !== 0 ? "error" : "done",
    };
  }
  return null;
}

function historyEntries(messages) {
  const toolCalls = historyToolCalls(messages);
  return messages.map((message, index) => historyEntry(message, index, toolCalls)).filter(Boolean);
}

function historyPage(messages, before = messages.length, limit = HISTORY_PAGE_SIZE) {
  const toolCalls = historyToolCalls(messages);
  const entries = [];
  for (let index = Math.min(before, messages.length) - 1; index >= 0 && entries.length < limit; index -= 1) {
    const entry = historyEntry(messages[index], index, toolCalls);
    if (entry) entries.push(entry);
  }
  const firstIndex = Number(entries.at(-1)?.id.replace("history-", ""));
  let hasMore = false;
  for (let index = Number.isFinite(firstIndex) ? firstIndex - 1 : -1; index >= 0; index -= 1) {
    if (historyEntry(messages[index], index, toolCalls)) { hasMore = true; break; }
  }
  return { entries: entries.reverse(), hasMore };
}

function getModelRuntime() {
  modelRuntimePromise ??= ModelRuntime.create();
  return modelRuntimePromise;
}

function toIpcSafe(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return undefined;
  if (Array.isArray(value)) return value.map((entry) => toIpcSafe(entry, seen)).filter((entry) => entry !== undefined);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      const safeEntry = toIpcSafe(entry, seen);
      if (safeEntry !== undefined) output[key] = safeEntry;
    }
    return output;
  }
  return String(value);
}

function sendChatEvent(chat, payload) {
  if (!chat.sender.isDestroyed()) {
    chat.sender.send(IPC_EVENTS.chat.event, toIpcSafe({ chatId: chat.id, ...payload }));
  }
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function textFromToolResult(result) {
  const content = textFromContent(result?.content);
  const patch = typeof result?.details?.patch === "string" ? result.details.patch : "";
  return [content, patch].filter(Boolean).join("\n\n").slice(0, 40_000);
}

function trackedSourcePath(chat, requestedPath) {
  if (typeof requestedPath !== "string" || !requestedPath) return undefined;
  for (const root of chat.roots) {
    const candidate = path.isAbsolute(requestedPath) ? path.resolve(requestedPath) : path.resolve(root.sourcePath, requestedPath);
    if (isPathInside(root.sourcePath, candidate)) {
      return candidate;
    }
    if (isPathInside(root.overlayPath, candidate)) {
      const overlayRelative = path.relative(root.overlayPath, candidate);
      return path.resolve(root.sourcePath, overlayRelative);
    }
  }
  return undefined;
}

function readPathsFromTool(chat, event) {
  const details = event.result?.details ?? {};
  let paths = [];
  if (["read", "edit"].includes(event.toolName)) paths = [event.args?.path];
  else if (event.toolName === "wc") paths = event.args?.paths ?? [];
  else if (event.toolName === "grep") paths = details.paths ?? [];
  else if (event.toolName === "diff") paths = details.path ? [details.path] : (details.changes ?? []).map((change) => change.path);
  return [...new Set(paths.map((entry) => trackedSourcePath(chat, entry)).filter(Boolean))];
}

function bindSessionEvents(chat) {
  return chat.session.subscribe((event) => {
    if (event.type === "agent_start") {
      sendChatEvent(chat, { type: "state", running: true });
      return;
    }
    if (event.type === "agent_settled") {
      sendChatEvent(chat, { type: "state", running: false });
      return;
    }
    if (event.type === "message_start" && event.message?.role === "assistant") {
      chat.activeAssistantId = randomUUID();
      sendChatEvent(chat, { type: "assistant-start", messageId: chat.activeAssistantId });
      return;
    }
    if (
      event.type === "message_update" &&
      (event.assistantMessageEvent?.type === "text_delta" ||
        event.assistantMessageEvent?.type === "thinking_delta") &&
      chat.activeAssistantId
    ) {
      sendChatEvent(chat, {
        type: "assistant-delta",
        messageId: chat.activeAssistantId,
        delta: event.assistantMessageEvent.delta,
        thought: event.assistantMessageEvent.type === "thinking_delta",
      });
      return;
    }
    if (event.type === "message_end" && event.message?.role === "assistant") {
      const messageId = chat.activeAssistantId ?? randomUUID();
      sendChatEvent(chat, {
        type: "assistant-end",
        messageId,
        content: textContent(event.message.content),
      });
      chat.activeAssistantId = undefined;
      return;
    }
    if (event.type === "tool_execution_start") {
      sendChatEvent(chat, {
        type: "tool-start",
        toolCallId: event.toolCallId,
        name: event.toolName,
        input: JSON.stringify(event.args, null, 2),
      });
      return;
    }
    if (event.type === "tool_execution_update") {
      sendChatEvent(chat, {
        type: "tool-update",
        toolCallId: event.toolCallId,
        content: textFromToolResult(event.partialResult),
      });
      return;
    }
    if (event.type === "tool_execution_end") {
      sendChatEvent(chat, {
        type: "tool-end",
        toolCallId: event.toolCallId,
        content: textFromToolResult(event.result),
        isError: event.isError,
      });
      if (!event.isError) {
        const paths = readPathsFromTool(chat, event);
        if (paths.length) sendChatEvent(chat, { type: "files-read", paths });
      }
      return;
    }
    if (event.type === "compaction_start") {
      sendChatEvent(chat, { type: "status", content: "Compacting context…" });
      return;
    }
    if (event.type === "auto_retry_start") {
      sendChatEvent(chat, {
        type: "status",
        content: `Retrying (${event.attempt}/${event.maxAttempts})…`,
      });
    }
  });
}

function getChatCommands(session) {
  const commands = [
    { name: "login", description: "Sign in to a model provider", source: "hardcode" },
    { name: "model", description: "Select the active model", source: "hardcode" },
    { name: "scoped-models", description: "Choose models available for cycling", source: "hardcode" },
    { name: "abort", description: "Stop the current operation", source: "hardcode" },
  ];

  for (const command of session.extensionRunner.getRegisteredCommands()) {
    commands.push({
      name: typeof command.invocationName === "string" ? command.invocationName : "",
      description: typeof command.description === "string" ? command.description : "",
      source: "extension",
    });
  }
  for (const template of session.promptTemplates) {
    commands.push({
      name: typeof template.name === "string" ? template.name : "",
      description: typeof template.description === "string" ? template.description : "",
      source: "prompt",
    });
  }
  for (const skill of session.resourceLoader.getSkills().skills) {
    commands.push({
      name: `skill:${typeof skill.name === "string" ? skill.name : ""}`,
      description: typeof skill.description === "string" ? skill.description : "",
      source: "skill",
    });
  }

  return [...new Map(commands.filter((command) => command.name).map((command) => [command.name, command])).values()];
}

async function getChatCompletions(chat, commandName, argumentPrefix) {
  const command = commandName.toLowerCase();
  const prefix = argumentPrefix.toLowerCase();
  let options = [];
  if (command === "model" || command === "scoped-models") {
    const models = await chat.modelRuntime.getAvailable();
    options = models.map((model) => ({
      value: `${model.provider}/${model.id}`,
      label: model.name || model.id,
      description: `${model.provider}/${model.id}`,
    }));
  } else if (command === "login") {
    options = chat.modelRuntime.getProviders().flatMap((provider) => [
      ...(provider.auth.oauth ? [{ value: provider.id, label: provider.auth.oauth.loginLabel || provider.name }] : []),
      ...(provider.auth.apiKey?.login ? [{ value: provider.id, label: `${provider.name} API key` }] : []),
    ]);
  } else {
    const registered = chat.session.extensionRunner.getRegisteredCommands().find((candidate) => candidate.invocationName === commandName || candidate.name === commandName);
    if (registered?.getArgumentCompletions) options = (await registered.getArgumentCompletions(argumentPrefix)) || [];
  }
  return options.filter((option) => `${option.value} ${option.label} ${option.description || ""}`.toLowerCase().includes(prefix));
}

async function createChatSession(event, chatId, workspaceId, taskId, requestedSessionFile) {
  const existing = chats.get(chatId);
  if (existing?.ownerId === event.sender.id) {
    if (existing.workspace.id === workspaceId && existing.taskId === taskId) return existing;
    closeChat(chatId, event.sender.id);
  }

  const { workspace, task } = await workspaceStore.requireTask(workspaceId, taskId);
  const taskChat = task?.chats.find((candidate) => candidate.id === chatId);
  if (!taskChat) throw new Error("Unknown task chat.");
  const { overlayRoot, roots } = await ensureTaskOverlay(workspace, task);
  const cwd = roots.length === 1 ? roots[0].overlayPath : overlayRoot;
  const rootInstructions = roots
    .map(
      (root, index) =>
        `${index + 1}. Original (read-only while working): ${root.sourcePath}\n` +
        `   Managed task overlay: ${root.overlayPath}`,
    )
    .join("\n");
  const communicationInstructions = `## Communication style
You are a proactive development partner, not a tool transcript.
- Before beginning a meaningful investigation or implementation phase, give one short plain-language update about what you are doing (for example: "I’ll check the existing authentication flow first."). Do not announce routine individual tool calls.
- Keep the user oriented at useful milestones only: a changed plan, a completed implementation, a blocker, or a decision that needs input. Continue working independently between those milestones.
- Be concise and outcome-focused. Do not explain implementation internals, command output, or every file operation unless the user asks.
- When finished, give a compact summary: outcome, the most relevant changed areas, validation performed (or not performed), and only open questions/blockers. Use short bullets when helpful.
- Match the user’s language. Preserve your autonomy: make routine engineering decisions yourself and ask only when a choice materially affects the result.
`;
  const overlayInstructions = `## Hardcode task overlay
You are working in a sparse task overlay. The original project folders remain the source for files that are not yet in the overlay, but the file tools present a merged working-tree view and manage overlay paths automatically.

${rootInstructions}

Rules for this task:
- Use read and ls with normal project paths; they automatically combine original files with task changes.
- If an original file changes after you edited it, Hardcode rebases your overlay with a three-way merge on the next file-tool access. A C entry in status is an unresolved conflict; inspect its current result with read and its difference from the original with diff, then resolve it with edit, write, or delete before mounting or completing the task.
- Use write and edit with normal project paths; they automatically write into the matching task overlay. edit copies an unchanged original file into the overlay when needed.
- Use delete and move for removals and renames. Never create overlay files or deletion markers yourself.
- The file tools are the default workflow. Prefer them for normal code research, file listing, reading, searching, line counting, reviewing diffs, Git status/diff commands, and all file changes. Use Bash only when it is genuinely necessary because these tools cannot express the required read-only operation.
- Do not mutate an original folder directly.
- Do not run installs, builds, tests, or formatters that require a complete writable project through the task tools. The user can mount this overlay into the original folders for live runtime testing.
- Bash remains available for genuinely necessary, exceptional read-only transformations that the file tools cannot express (for example a one-off awk or jq analysis). It has separate container paths; follow its dedicated instructions below rather than using host paths directly.
`;
  const overlayTooling = createOverlayTooling({
    cwd,
    sourceRoots: roots,
    resolveSourcePath: (projectPath) => overlayMountManager.logicalPath(projectPath),
    logicalOverrides: (rootPath) => overlayMountManager.logicalOverrides(rootPath),
    adjustDirectoryEntries: (directoryPath, entries) => overlayMountManager.adjustDirectoryEntries(directoryPath, entries),
    canUsePhysicalSource: () => {
      const mounted = overlayMountManager.current();
      return mounted?.workspaceId === workspaceId && mounted?.taskId === taskId;
    },
    onDidMutate: () => overlayMountManager.sync(),
  });
  const documentTooling = createDocumentTooling({
    workspaceRoot: workspacePath(workspace),
    taskId: task.id,
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: piAgentDirectory,
    appendSystemPromptOverride: (base) => [
      ...base,
      communicationInstructions,
      overlayInstructions,
      overlayTooling.systemPrompt,
      "## Hardcode documents\n- Use document tools for notes and memory; do not put documents into the task overlay.\n- Workspace notes and workspace memory belong to the whole workspace; task notes and task memory belong only to this task.\n- Prefer concise Markdown documents and read existing documents before replacing them.",
    ],
  });
  await resourceLoader.reload();

  const modelRuntime = await getModelRuntime();
  const sessionDirectory = taskSessionPath(workspace, task);
  const sessionFile = taskChat.sessionFile || requestedSessionFile;
  const resolvedSessionFile = typeof sessionFile === "string" ? path.resolve(sessionFile) : "";
  const canOpenSession =
    resolvedSessionFile &&
    existsSync(resolvedSessionFile) &&
    isPathInside(sessionDirectory, resolvedSessionFile);
  const { session } = await createAgentSession({
    cwd,
    modelRuntime,
    resourceLoader,
    tools: [
      "read",
      "ls",
      "status",
      "diff",
      "grep",
      "find",
      "wc",
      "revert",
      "bash",
      "edit",
      "write",
      "delete",
      "move",
      "document_list",
      "document_read",
      "document_write",
      "document_search",
    ],
    customTools: [...overlayTooling.customTools, ...documentTooling.customTools],
    sessionManager: canOpenSession
      ? SessionManager.open(resolvedSessionFile)
      : SessionManager.create(cwd, sessionDirectory),
  });
  const chat = {
    id: chatId,
    ownerId: event.sender.id,
    sender: event.sender,
    session,
    modelRuntime,
    workspace,
    task,
    taskId,
    roots,
  };
  chats.set(chatId, chat);
  chat.unsubscribe = bindSessionEvents(chat);
  await session.bindExtensions({ uiContext: createExtensionUI(chat), mode: "rpc" });

  sendChatEvent(chat, {
    type: "ready",
    model: session.model && session.model.provider !== "unknown"
      ? { provider: session.model.provider, id: session.model.id, name: session.model.name }
      : null,
    commands: getChatCommands(session),
  });
  return chat;
}

function requireChat(event, chatId) {
  const chat = chats.get(chatId);
  if (!chat || chat.ownerId !== event.sender.id) throw new Error("Unknown chat session.");
  return chat;
}

async function chooseModel(chat, providerId) {
  const available = await chat.modelRuntime.getAvailable(providerId);
  if (available.length === 0) {
    sendChatEvent(chat, { type: "error", content: "No authenticated models are available." });
    return;
  }

  const options = available.map((model, index) => ({
    id: String(index),
    label: model.name || model.id,
    description: `${model.provider}/${model.id}`,
  }));
  const response = await requestInteraction(chat, { type: "select", title: "Select model", options });
  if (response.cancelled) return;
  const model = available[Number(response.value)];
  if (!model) return;
  await chat.session.setModel(model);
  sendChatEvent(chat, {
    type: "model",
    model: { provider: model.provider, id: model.id, name: model.name },
  });
}

async function chooseScopedModels(chat) {
  const available = await chat.modelRuntime.getAvailable();
  if (available.length === 0) {
    sendChatEvent(chat, { type: "error", content: "No authenticated models are available." });
    return;
  }
  const selected = new Set(chat.session.scopedModels.map(({ model }) => `${model.provider}/${model.id}`));
  const response = await requestInteraction(chat, {
    type: "multi-select",
    title: "Models available for cycling",
    options: available.map((model, index) => ({
      id: String(index),
      label: model.name || model.id,
      description: `${model.provider}/${model.id}`,
      selected: selected.size === 0 || selected.has(`${model.provider}/${model.id}`),
    })),
  });
  if (response.cancelled) return;
  const models = (response.values ?? []).map((value) => available[Number(value)]).filter(Boolean);
  chat.session.setScopedModels(models.map((model) => ({ model })));
  sendChatEvent(chat, { type: "status", content: `${models.length} models enabled for cycling.` });
}

async function login(chat) {
  const choices = [];
  for (const provider of chat.modelRuntime.getProviders()) {
    if (provider.auth.oauth) {
      choices.push({ provider, authType: "oauth", label: provider.auth.oauth.loginLabel ?? provider.name });
    }
    if (provider.auth.apiKey?.login) {
      choices.push({ provider, authType: "api_key", label: `${provider.name} API key` });
    }
  }

  const response = await requestInteraction(chat, {
    type: "select",
    title: "Sign in to a provider",
    options: choices.map((choice, index) => ({
      id: String(index),
      label: choice.label,
      description: choice.authType === "oauth" ? "Account or subscription" : "API key",
    })),
  });
  if (response.cancelled) return;
  const choice = choices[Number(response.value)];
  if (!choice) return;

  let noticeId;
  const operationAbort = new AbortController();
  chat.operationAbort?.abort();
  chat.operationAbort = operationAbort;
  const showNotice = (interaction) => {
    if (noticeId) clearInteraction(chat, noticeId);
    noticeId = sendInteraction(chat, interaction);
  };

  try {
    await chat.modelRuntime.login(choice.provider.id, choice.authType, {
      signal: operationAbort.signal,
      prompt: async (prompt) => {
        const interaction =
          prompt.type === "select"
            ? {
                type: "select",
                title: prompt.message,
                options: prompt.options.map((option) => ({
                  id: option.id,
                  label: option.label,
                  description: option.description,
                })),
              }
            : {
                type: "input",
                title: prompt.message,
                placeholder: prompt.placeholder,
                secret: prompt.type === "secret",
              };
        const answer = await requestInteraction(chat, interaction, prompt.signal);
        if (answer.cancelled) throw new Error("Login cancelled");
        return answer.value;
      },
      notify: (event) => {
        if (event.type === "auth_url") {
          showNotice({ type: "link", title: "Continue in your browser", url: event.url, instructions: event.instructions });
        } else if (event.type === "device_code") {
          showNotice({
            type: "link",
            title: "Authorize this device",
            url: event.verificationUri,
            code: event.userCode,
            instructions: "Enter this code in the browser, then return to Hardcode.",
          });
        } else if (event.type === "info") {
          showNotice({ type: "progress", title: "Sign in", message: event.message, links: event.links });
        } else {
          showNotice({ type: "progress", title: "Sign in", message: event.message });
        }
      },
    });
    await chat.modelRuntime.refresh({ providers: [choice.provider.id] });
    sendChatEvent(chat, { type: "status", content: `Signed in to ${choice.provider.name}.` });
    await chooseModel(chat, choice.provider.id);
  } finally {
    if (noticeId) clearInteraction(chat, noticeId);
    if (chat.operationAbort === operationAbort) chat.operationAbort = undefined;
  }
}

async function handleChatInput(chat, message) {
  const trimmed = message.trim();
  const match = trimmed.match(/^\/(\S+)(?:\s+(.+))?$/);
  const command = match?.[1]?.toLowerCase();
  const argument = match?.[2]?.trim();
  if (command === "login") return login(chat);
  if (command === "model") {
    if (argument) {
      const model = (await chat.modelRuntime.getAvailable()).find((candidate) => `${candidate.provider}/${candidate.id}` === argument || candidate.id === argument || candidate.name === argument);
      if (model) { await chat.session.setModel(model); sendChatEvent(chat, { type: "model", model: { provider: model.provider, id: model.id, name: model.name } }); return; }
    }
    return chooseModel(chat);
  }
  if (command === "scoped-models") return chooseScopedModels(chat);
  if (command === "abort") return chat.session.abort();

  await chat.session.prompt(message, {
    streamingBehavior: chat.session.isStreaming ? "steer" : undefined,
  });
}

function closeChat(chatId, ownerId) {
  const chat = chats.get(chatId);
  if (!chat || chat.ownerId !== ownerId) return;
  chats.delete(chatId);
  for (const [id, pending] of pendingInteractions) {
    if (pending.chatId === chatId) pending.reject(new Error("Chat closed"));
  }
  chat.unsubscribe?.();
  chat.session.dispose();
}

function closeChatsForOwner(ownerId) {
  for (const [chatId, chat] of chats) {
    if (chat.ownerId === ownerId) closeChat(chatId, ownerId);
  }
}

function closeForTask(workspaceId, taskId, ownerId) {
  for (const [chatId, chat] of chats) {
    if (chat.ownerId === ownerId && chat.workspace.id === workspaceId && chat.taskId === taskId) {
      closeChat(chatId, ownerId);
    }
  }
}

function closeAll() {
  for (const [chatId, chat] of chats) closeChat(chatId, chat.ownerId);
}

function respondInteraction(chatId, ownerId, interactionId, response) {
  const pending = pendingInteractions.get(interactionId);
  if (!pending || pending.chatId !== chatId || pending.ownerId !== ownerId) {
    throw new Error("Unknown interaction.");
  }
  pending.resolve(response);
}

function registerIpc(ipc) {
  registerChatIpc({
    ipc,
    shell,
    api: {
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
    },
  });
}

return { registerIpc, closeForOwner: closeChatsForOwner, closeForTask, closeAll };
}
