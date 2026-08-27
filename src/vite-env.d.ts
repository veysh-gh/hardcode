/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

interface ChatModel {
  provider: string;
  id: string;
  name?: string;
}

interface ChatCommand {
  name: string;
  description?: string;
  source: "hardcode" | "extension" | "prompt" | "skill";
}

interface ChatCompletion {
  value: string;
  label: string;
  description?: string;
}

interface WorkspaceFolder {
  path: string;
  defaultBranch: string;
}

interface WorkspaceRecord {
  id: string;
  name: string;
  folders: WorkspaceFolder[];
  tasks: WorkspaceTaskRecord[];
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceTaskChatRecord {
  id: string;
  sessionFile?: string;
  hasActivity: boolean;
}

interface WorkspaceTaskRecord {
  id: string;
  name: string;
  chats: WorkspaceTaskChatRecord[];
  selectedFilePath: string;
  readPaths: string[];
  completionSeen: boolean;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceInput {
  name: string;
  folders: WorkspaceFolder[];
}

interface GitChange {
  path: string;
  status: string;
}

interface GitRepository {
  root: string;
  name: string;
  branch: string;
  staged: GitChange[];
  unstaged: GitChange[];
}

interface WorkspaceTreeEntry {
  name: string;
  path: string;
  type: "directory" | "file";
  status?: "added" | "modified" | "deleted";
}

interface ProjectTreeNodeRecord extends WorkspaceTreeEntry {
  meta?: string;
  expanded: boolean;
  loading: boolean;
  error?: string;
  children?: ProjectTreeNodeRecord[] | null;
}

interface WorkspaceFile {
  path: string;
  content: string;
  originalContent?: string;
  status?: "added" | "modified" | "deleted";
  mergeConflict?: {
    revision: string;
    stale: boolean;
    baseContent: string;
    taskContent: string;
    originalContent: string;
    resultContent: string;
    mergeContent: string;
  };
}

type WorkspaceDiffMode = "full" | "current" | "task";

interface ChatEntry {
  id: string;
  kind: "user" | "assistant" | "tool" | "status" | "error";
  content: string;
  title?: string;
  input?: string;
  status?: "running" | "done" | "error";
}

interface ChatInteractionOption {
  id: string;
  label: string;
  description?: string;
  selected?: boolean;
}

interface ChatInteractionLink {
  url: string;
  label?: string;
}

interface ChatInteraction {
  id: string;
  type: "select" | "multi-select" | "confirm" | "input" | "link" | "progress";
  title: string;
  message?: string;
  options: ChatInteractionOption[];
  placeholder?: string;
  value?: string;
  secret?: boolean;
  multiline?: boolean;
  url: string;
  code?: string;
  instructions?: string;
  links?: ChatInteractionLink[];
}

interface InteractionResponse {
  value?: string;
  values?: string[];
  confirmed?: boolean;
  cancelled?: boolean;
}

interface InteractionAnswer {
  id: string;
  response: InteractionResponse;
}

interface ChatEventPayload {
  chatId: string;
  type:
    | "ready"
    | "state"
    | "model"
    | "assistant-start"
    | "assistant-delta"
    | "assistant-end"
    | "tool-start"
    | "tool-update"
    | "tool-end"
    | "files-read"
    | "status"
    | "error";
  running?: boolean;
  model?: ChatModel | null;
  commands?: ChatCommand[];
  messageId?: string;
  delta?: string;
  thought?: boolean;
  content?: string;
  toolCallId?: string;
  name?: string;
  input?: string;
  isError?: boolean;
  paths?: string[];
}

interface ChatInteractionPayload {
  chatId: string;
  interaction: ChatInteraction;
}

interface ChatInteractionClearPayload {
  chatId: string;
  id: string;
}

interface HardcodeApi {
  workspace: {
    list(): Promise<WorkspaceRecord[]>;
    pickFolders(): Promise<string[]>;
    create(input: WorkspaceInput): Promise<WorkspaceRecord>;
    saveTasks(workspaceId: string, tasks: WorkspaceTaskRecord[]): Promise<WorkspaceTaskRecord[]>;
    readDirectory(
      workspaceId: string,
      directoryPath: string,
      taskId: string,
      diffMode?: WorkspaceDiffMode,
    ): Promise<WorkspaceTreeEntry[]>;
    readFile(
      workspaceId: string,
      filePath: string,
      taskId: string,
      diffMode?: WorkspaceDiffMode,
    ): Promise<WorkspaceFile>;
    writeFile(workspaceId: string, filePath: string, taskId: string, content: string): Promise<void>;
    restoreFile(workspaceId: string, filePath: string, taskId: string): Promise<void>;
    resolveConflict(workspaceId: string, filePath: string, taskId: string, content: string, revision: string): Promise<void>;
  };
  git: {
    status(workspaceId: string): Promise<GitRepository[]>;
    updateIndex(workspaceId: string, repositoryRoot: string, action: "stage" | "unstage", filePath: string): Promise<void>;
    commit(workspaceId: string, repositoryRoot: string, message: string): Promise<void>;
  };
  documents: {
    list(workspaceId: string, taskId: string, scope: "task-notes" | "workspace-notes" | "task-memory" | "workspace-memory"): Promise<string[]>;
    read(workspaceId: string, taskId: string, scope: "task-notes" | "workspace-notes" | "task-memory" | "workspace-memory", path: string): Promise<string>;
    write(workspaceId: string, taskId: string, scope: "task-notes" | "workspace-notes" | "task-memory" | "workspace-memory", path: string, content: string): Promise<void>;
  };
  task: {
    status(
      workspaceId: string,
      taskId: string,
    ): Promise<{
      hasChanges: boolean;
      changeCount: number;
      hasTaskChanges: boolean;
      issue?: string;
      mounted: boolean;
      mountedTask?: { workspaceId: string; taskId: string; taskName: string };
    }>;
    mount(workspaceId: string, taskId: string): Promise<{ mounted: true }>;
    unmount(workspaceId: string, taskId: string): Promise<{ mounted: false }>;
    complete(
      workspaceId: string,
      taskId: string,
      options: { archive: boolean; name?: string },
    ): Promise<{ archived: boolean; name: string }>;
    remove(workspaceId: string, taskId: string): Promise<void>;
    branch(workspaceId: string, taskId: string): Promise<WorkspaceTaskRecord>;
  };
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
  };
  chat: {
    start(
      chatId: string,
      workspaceId: string,
      taskId: string,
      sessionFile?: string,
    ): Promise<{
      chatId: string;
      sessionFile?: string;
      entries: ChatEntry[];
      ready: boolean;
      model: ChatModel | null;
      commands: ChatCommand[];
    }>;
    send(chatId: string, message: string): Promise<{ accepted: boolean }>;
    complete(chatId: string, command: string, argumentPrefix: string): Promise<ChatCompletion[]>;
    abort(chatId: string): Promise<void>;
    close(chatId: string): Promise<void>;
    branch(chatId: string, newChatId: string): Promise<{ sessionFile: string; entries: ChatEntry[] }>;
    respond(chatId: string, interactionId: string, response: InteractionResponse): Promise<void>;
    openExternal(url: string): Promise<void>;
    onEvent(listener: (payload: ChatEventPayload) => void): () => void;
    onInteraction(listener: (payload: ChatInteractionPayload) => void): () => void;
    onInteractionClear(listener: (payload: ChatInteractionClearPayload) => void): () => void;
  };
}

interface Window {
  hardcode?: HardcodeApi;
}
