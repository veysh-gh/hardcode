function contract(channel, parse = noArguments) {
  return Object.freeze({ channel, parse });
}

function noArguments(args) {
  if (args.length !== 0) throw new Error("This IPC request does not accept input.");
  return undefined;
}

function singleRequest(args, parse) {
  if (args.length !== 1) throw new Error("Invalid IPC request.");
  return parse(parseObject(args[0]));
}

function parseObject(value, label = "request") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function parseString(value, label, { allowEmpty = false, maxLength } = {}) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new Error(`Invalid ${label}.`);
  }
  if (maxLength && value.length > maxLength) throw new Error(`${label} is too long.`);
  return value;
}

function parseOptionalString(value, label, options) {
  if (value === undefined || value === null) return undefined;
  if (value === "" && !options?.allowEmpty) return undefined;
  return parseString(value, label, options);
}

function parseId(value, label) {
  const id = parseString(value, label, { maxLength: 200 });
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid ${label}.`);
  return id;
}

function parseOptionalId(value, label) {
  return value === undefined || value === null || value === ""
    ? undefined
    : parseId(value, label);
}

function parseBoolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`Invalid ${label}.`);
  return value;
}

function parseArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function parseEnum(value, values, label) {
  if (!values.includes(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function requestContract(channel, parseRequest) {
  return contract(channel, (args) => singleRequest(args, parseRequest));
}

function idsRequest(value) {
  return {
    workspaceId: parseId(value.workspaceId, "workspace id"),
    taskId: parseId(value.taskId, "task id"),
  };
}

function documentRequest(value, { requirePath = false, requireContent = false } = {}) {
  const request = {
    workspaceId: parseId(value.workspaceId, "workspace id"),
    taskId: parseOptionalId(value.taskId, "task id"),
    scope: parseEnum(
      value.scope,
      ["workspace-notes", "workspace-memory", "task-notes", "task-memory"],
      "document scope",
    ),
  };
  if (requirePath) request.path = parseString(value.path, "document path");
  if (requireContent) request.content = parseString(value.content, "document content", { allowEmpty: true });
  return request;
}

function interactionResponse(value) {
  const response = parseObject(value, "interaction response");
  return {
    value: parseOptionalString(response.value, "interaction value", { allowEmpty: true }),
    values: response.values === undefined
      ? undefined
      : parseArray(response.values, "interaction values").map((entry) =>
        parseString(entry, "interaction value", { allowEmpty: true })),
    confirmed: response.confirmed === undefined
      ? undefined
      : parseBoolean(response.confirmed, "interaction confirmation"),
    cancelled: response.cancelled === undefined
      ? undefined
      : parseBoolean(response.cancelled, "interaction cancellation"),
  };
}

export const IPC = Object.freeze({
  workspace: Object.freeze({
    list: contract("workspace:list"),
    pickFolders: contract("workspace:pick-folders"),
    create: requestContract("workspace:create", (value) => ({
      input: parseObject(value.input, "workspace input"),
    })),
    saveTasks: requestContract("workspace:save-tasks", (value) => ({
      workspaceId: parseId(value.workspaceId, "workspace id"),
      tasks: parseArray(value.tasks, "tasks"),
    })),
    readDirectory: requestContract("workspace:read-directory", (value) => ({
      ...idsRequest(value),
      path: parseString(value.path, "directory path", { allowEmpty: true }),
      diffMode: value.diffMode === undefined
        ? "current"
        : parseEnum(value.diffMode, ["full", "current", "task"], "diff mode"),
    })),
    readFile: requestContract("workspace:read-file", (value) => ({
      ...idsRequest(value),
      path: parseString(value.path, "file path"),
      diffMode: value.diffMode === undefined
        ? "current"
        : parseEnum(value.diffMode, ["full", "current", "task"], "diff mode"),
    })),
    writeFile: requestContract("workspace:write-file", (value) => ({
      ...idsRequest(value),
      path: parseString(value.path, "file path"),
      content: parseString(value.content, "file content", { allowEmpty: true }),
    })),
    restoreFile: requestContract("workspace:restore-file", (value) => ({
      ...idsRequest(value),
      path: parseString(value.path, "file path"),
    })),
    resolveConflict: requestContract("workspace:resolve-conflict", (value) => ({
      ...idsRequest(value),
      path: parseString(value.path, "file path"),
      content: parseString(value.content, "merge result", { allowEmpty: true }),
      revision: parseString(value.revision, "conflict revision"),
    })),
  }),

  task: Object.freeze({
    status: requestContract("task:status", idsRequest),
    mount: requestContract("task:mount", idsRequest),
    unmount: requestContract("task:unmount", idsRequest),
    complete: requestContract("task:complete", (value) => {
      const request = idsRequest(value);
      const options = value.options === undefined ? {} : parseObject(value.options, "task completion options");
      return {
        ...request,
        options: {
          archive: options.archive === undefined ? false : parseBoolean(options.archive, "archive option"),
          name: parseOptionalString(options.name, "task name", { maxLength: 200 }),
        },
      };
    }),
    remove: requestContract("task:remove", idsRequest),
    branch: requestContract("task:branch", idsRequest),
  }),

  documents: Object.freeze({
    list: requestContract("documents:list", (value) => documentRequest(value)),
    read: requestContract("documents:read", (value) => documentRequest(value, { requirePath: true })),
    write: requestContract("documents:write", (value) =>
      documentRequest(value, { requirePath: true, requireContent: true })),
  }),

  git: Object.freeze({
    status: requestContract("git:status", (value) => ({
      workspaceId: parseId(value.workspaceId, "workspace id"),
    })),
    updateIndex: requestContract("git:update-index", (value) => ({
      workspaceId: parseId(value.workspaceId, "workspace id"),
      repositoryRoot: parseString(value.repositoryRoot, "repository root"),
      action: parseEnum(value.action, ["stage", "unstage"], "Git action"),
      filePath: parseString(value.filePath, "Git file path"),
    })),
    commit: requestContract("git:commit", (value) => ({
      workspaceId: parseId(value.workspaceId, "workspace id"),
      repositoryRoot: parseString(value.repositoryRoot, "repository root"),
      message: parseString(value.message, "commit message", { maxLength: 10_000 }),
    })),
  }),

  window: Object.freeze({
    minimize: contract("window:minimize"),
    toggleMaximize: contract("window:toggle-maximize"),
    close: contract("window:close"),
  }),

  chat: Object.freeze({
    start: requestContract("chat:start", (value) => ({
      chatId: parseId(value.chatId, "chat id"),
      workspaceId: parseId(value.workspaceId, "workspace id"),
      taskId: parseId(value.taskId, "task id"),
      sessionFile: parseOptionalString(value.sessionFile, "session file"),
    })),
    complete: requestContract("chat:complete", (value) => ({
      chatId: parseId(value.chatId, "chat id"),
      command: parseString(value.command, "command"),
      argumentPrefix: value.argumentPrefix === undefined
        ? ""
        : parseString(value.argumentPrefix, "argument prefix", { allowEmpty: true }),
    })),
    send: requestContract("chat:send", (value) => ({
      chatId: parseId(value.chatId, "chat id"),
      message: parseString(value.message, "message", { maxLength: 64_000 }),
    })),
    abort: requestContract("chat:abort", (value) => ({ chatId: parseId(value.chatId, "chat id") })),
    close: requestContract("chat:close", (value) => ({ chatId: parseId(value.chatId, "chat id") })),
    branch: requestContract("chat:branch", (value) => ({
      chatId: parseId(value.chatId, "chat id"),
      newChatId: parseId(value.newChatId, "branched chat id"),
    })),
    respond: requestContract("chat:interaction-response", (value) => ({
      chatId: parseId(value.chatId, "chat id"),
      interactionId: parseId(value.interactionId, "interaction id"),
      response: value.response === undefined ? {} : interactionResponse(value.response),
    })),
    openExternal: requestContract("chat:open-external", (value) => ({
      url: parseString(value.url, "external URL", { maxLength: 8_192 }),
    })),
  }),
});

export const IPC_EVENTS = Object.freeze({
  chat: Object.freeze({
    event: "chat:event",
    interaction: "chat:interaction",
    interactionClear: "chat:interaction-clear",
  }),
});
