<template>
  <div class="app">
    <header class="app-header">
      <AppButton
        class="icon-control-button hamburger-button"
        size="control"
        variant="subtle"
        type="button"
        aria-label="Toggle workspace menu"
        title="Workspaces"
        @click="toggleWorkspaceMenu"
      >
        <span></span>
        <span></span>
        <span></span>
      </AppButton>
      <AppButton
        v-if="activeWorkspace"
        class="active-workspace-name"
        type="button"
        size="small"
        variant="subtle"
        :active="projectOverview"
        :title="`Open project overview for ${activeWorkspace.name}`"
        @click="openProjectOverview"
      >{{ activeWorkspace.name }}</AppButton>
      <TaskTabs
        v-if="activeWorkspace"
        :tasks="tasks"
        :active-task-id="projectOverview ? '' : activeTaskId"
        @select="activateTask"
        @create="createTask"
      />
      <div v-if="activeWorkspace" class="document-controls">
        <AppButton type="button" size="small" title="Manage memory" @click="documentManager = 'memory'">Manage memory</AppButton>
        <AppButton type="button" size="small" title="Notebook" @click="documentManager = 'notes'">Notebook</AppButton>
      </div>
      <div class="window-controls" aria-label="Window controls">
        <AppButton class="window-control window-minimize-control" size="icon" type="button" aria-label="Minimize" title="Minimize" @click="minimizeWindow">─</AppButton>
        <AppButton class="window-control" size="icon" type="button" aria-label="Maximize or restore" title="Maximize or restore" @click="toggleWindowMaximize">□</AppButton>
        <AppButton class="window-control window-close-control" size="icon" type="button" aria-label="Close" title="Close" @click="closeWindow">×</AppButton>
      </div>
    </header>

    <WorkspaceMenu
      v-if="workspaceMenuOpen"
      :workspaces="workspaces"
      :active-workspace-id="activeWorkspace?.id"
      :pinned="!activeWorkspace"
      @close="workspaceMenuOpen = false"
      @manage="manageWorkspaces"
      @select="openWorkspace"
    />

    <WorkspaceManager
      v-if="!activeWorkspace"
      class="workspace-manager-view"
      :light-mode="lightMode"
      @created="workspaceCreated"
      @toggle-light-mode="toggleLightMode"
    />

    <main v-else-if="activeWorkspace" class="workspace" :style="workspaceGridStyle">
      <ProjectOverview
        v-if="projectOverview"
        class="project-overview-view"
        :workspace="activeWorkspace"
        :tasks="tasks"
        @create-task="createTask"
        @select-task="activateTask"
      />
      <template v-else-if="activeTask">
      <section class="chat-pane">
        <header class="task-chat-toolbar">
          <span>Chats</span>
          <AppButton type="button" size="small" @click="addChat">+ Chat</AppButton>
        </header>
        <div class="chat-grid" :class="chatGridClass">
          <ChatComponent
            v-for="chat in activeTask.chats"
            :key="chat.id"
            :entries="chat.entries"
            :interactions="chat.interactions"
            :ready="chat.ready"
            :start-error="chat.startError"
            :running="chat.running"
            :thought="chat.thought"
            :has-older="chat.hasOlderHistory"
            :loading-older="chat.loadingOlderHistory"
            :model="chat.model"
            :commands="chat.commands"
            :chat-id="chat.id"
            @close="closeChat(chat.id)"
            @branch="branchChat(chat)"
            @send="sendMessage(chat, $event)"
            @answer="answerInteraction(chat, $event)"
            @abort="abortChat(chat)"
            @open-link="openExternal(chat, $event)"
            @open-file="openToolFile(chat, $event)"
            @retry="startChat(activeTask, chat)"
            @load-older="loadOlderChatHistory(chat)"
            @unload-older="unloadOlderChatHistory(chat)"
          />
        </div>
      </section>
      <div
        class="panel-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat and editor panels"
        @pointerdown="startPanelResize('workspace', $event)"
      ></div>
      <section class="right-pane">
        <nav class="right-pane-tabs" aria-label="Project view">
          <AppButton type="button" size="small" variant="subtle" :active="activeTask.rightView === 'full'" @click="setRightView('full')">Full</AppButton>
          <AppButton type="button" size="small" variant="subtle" :active="activeTask.rightView === 'current'" @click="setRightView('current')">
            Current diff<span v-if="activeTask.overlayState === 'dirty'" class="diff-dot" aria-label="Changes"></span>
          </AppButton>
          <AppButton type="button" size="small" variant="subtle" :active="activeTask.rightView === 'task'" @click="setRightView('task')">Task diff</AppButton>
        </nav>
        <div class="right-pane-content" :style="rightPaneGridStyle">
          <EditorComponent
            :file="activeTask.selectedFile"
            :diff-mode="activeTask.rightView !== 'full'"
            @change="saveProjectFile"
            @resolve="resolveProjectConflict"
            @revert="revertProjectFile"
            @restore="restoreProjectFile"
          />
          <div
            class="panel-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize editor and file tree panels"
            @pointerdown="startPanelResize('right', $event)"
          ></div>
          <ProjectTree
            :workspace="activeWorkspace"
            :task-id="activeTask.id"
            :selected-path="activeTask.selectedFilePath"
            :read-paths="activeTask.readPaths"
            :refresh-key="activeTask.treeRevision"
            :diff-mode="activeTask.rightView"
            @select="selectProjectFile"
          />
        </div>
      </section>
      <footer class="task-actions">
        <span v-if="activeTask.actionError || activeTask.overlayIssue" class="task-action-error">
          {{ activeTask.actionError || activeTask.overlayIssue }}
        </span>
        <AppButton
          v-if="activeTask.overlayState === 'error'"
          type="button"
          :disabled="Boolean(activeTask.actionBusy)"
          @click="refreshTaskOverlayState(activeTask)"
        >
          Retry status
        </AppButton>
        <AppButton
          type="button"
          :disabled="Boolean(activeTask.actionBusy) || activeTask.chats.some((chat) => chat.running)"
          :title="activeTask.actionBusy ? 'Another task action is running.' : activeTask.chats.some((chat) => chat.running) ? 'Wait until all chats have finished.' : 'Create a new task from this task, including its changes and chats.'"
          class="branch-task-button"
          @click="branchTask"
        >
          Branch task
        </AppButton>
        <AppButton
          type="button"
          class="delete-task-button"
          variant="danger"
          :disabled="Boolean(activeTask.actionBusy)"
          :title="activeTask.actionBusy ? 'Another task action is running.' : 'Discard this task.'"
          @click="deleteTask"
        >
          Delete task
        </AppButton>
        <AppButton
          type="button"
          :variant="activeTask.mounted ? 'primary' : 'default'"
          :disabled="
            Boolean(activeTask.actionBusy) ||
            (!activeTask.mounted && (
              activeTask.overlayState === 'checking' ||
              activeTask.overlayState === 'error' ||
              Boolean(activeTask.overlayIssue)
            ))
          "
          :active="activeTask.mounted"
          :title="mountDisabledReason(activeTask)"
          @click="toggleTaskMount"
        >
          {{ taskActionBusy === "mount" ? (activeTask.mounted ? "Unmounting…" : "Mounting…") : (activeTask.mounted ? "Unmount task" : "Mount task") }}
        </AppButton>
        <AppButton
          type="button"
          :disabled="Boolean(activeTask.actionBusy) || activeTask.overlayState === 'checking' || activeTask.overlayState === 'error' || Boolean(activeTask.overlayIssue)"
          :title="completeDisabledReason(activeTask)"
          @click="completeTask"
        >
          {{ taskActionBusy === "finish" ? "Finishing…" : "Complete task" }}
        </AppButton>
      </footer>

      <AppDialog
        :open="activeTask.pendingAction === 'delete'"
        title="Delete task?"
        confirm-label="Delete task"
        danger
        @cancel="cancelTaskRemoval"
        @confirm="confirmTaskRemoval"
      >
        <p>“{{ activeTask.name }}” and its remaining overlay changes will be permanently removed.</p>
      </AppDialog>

      <AppDialog
        :open="activeTask.pendingAction === 'complete'"
        title="Finish task"
        @cancel="cancelTaskRemoval"
      >
        <p>The current task changes will be applied to the original project.</p>
        <label class="finish-task-name">
          <span>New task name for continuing <small>(optional)</small></span>
          <input
            v-model="finishTaskName"
            type="text"
            maxlength="200"
            autofocus
            :placeholder="activeTask.name"
          />
        </label>
        <template #actions>
          <AppButton type="button" @click="cancelTaskRemoval">Cancel</AppButton>
          <AppButton type="button" @click="finishActiveTask(false)">{{ finishTaskName.trim() ? "Rename & continue" : "Continue task" }}</AppButton>
          <AppButton type="button" variant="primary" @click="finishActiveTask(true)">Archive task</AppButton>
        </template>
      </AppDialog>
      </template>
    </main>

    <EmptyTaskState v-else @create="createTask" />

    <DocumentManager
      v-if="activeWorkspace && documentManager"
      :open="Boolean(documentManager)"
      :kind="documentManager"
      :title="documentManager === 'memory' ? 'Manage memory' : 'Notebook'"
      :workspace-id="activeWorkspace.id"
      :task-id="activeTask?.id ?? ''"
      :task-name="activeTask?.name ?? ''"
      :workspace-name="activeWorkspace.name"
      @close="documentManager = ''"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import AppButton from "./components/ui/AppButton.vue";
import AppDialog from "./components/ui/AppDialog.vue";
import ChatComponent from "./components/chat/ChatComponent.vue";
import DocumentManager from "./components/documents/DocumentManager.vue";
import EditorComponent from "./components/editor/EditorComponent.vue";
import EmptyTaskState from "./components/task/EmptyTaskState.vue";
import ProjectTree from "./components/workspace/ProjectTree.vue";
import ProjectOverview from "./components/workspace/ProjectOverview.vue";
import TaskTabs from "./components/task/TaskTabs.vue";
import WorkspaceManager from "./components/workspace/WorkspaceManager.vue";
import WorkspaceMenu from "./components/workspace/WorkspaceMenu.vue";

interface OpenChat extends WorkspaceTaskChatRecord {
  entries: ChatEntry[];
  interactions: ChatInteraction[];
  ready: boolean;
  running: boolean;
  thought: string;
  started: boolean;
  startError: string;
  model: ChatModel | null;
  commands: ChatCommand[];
  hasOlderHistory: boolean;
  loadingOlderHistory: boolean;
  historyBaselineEntryId: string;
}

interface OpenTask extends Omit<WorkspaceTaskRecord, "chats"> {
  chats: OpenChat[];
  selectedFile: WorkspaceFile | null;
  rightView: WorkspaceDiffMode;
  treeRevision: number;
  overlayState: "checking" | "clean" | "dirty" | "error";
  overlayIssue: string;
  overlayRequestId: number;
  mounted: boolean;
  mountedTask?: { workspaceId: string; taskId: string; taskName: string };
  actionBusy: "" | "mount" | "finish" | "remove" | "branch";
  actionError: string;
  pendingAction: "" | "delete" | "complete";
}

function newChat(record?: Partial<WorkspaceTaskChatRecord>): OpenChat {
  return {
    id: record?.id ?? crypto.randomUUID(),
    sessionFile: record?.sessionFile,
    hasActivity: Boolean(record?.hasActivity),
    entries: [],
    interactions: [],
    ready: false,
    running: false,
    thought: "",
    started: false,
    startError: "",
    model: null,
    commands: [],
    hasOlderHistory: false,
    loadingOlderHistory: false,
    historyBaselineEntryId: "",
  };
}

function openTask(record: WorkspaceTaskRecord): OpenTask {
  return {
    ...record,
    readPaths: record.readPaths ?? [],
    chats: record.chats.map((chat) => newChat(chat)),
    selectedFile: null,
    rightView: "full",
    treeRevision: 0,
    overlayState: "checking",
    overlayIssue: "",
    overlayRequestId: 0,
    mounted: false,
    mountedTask: undefined,
    actionBusy: "",
    actionError: "",
    pendingAction: "",
  };
}

export default defineComponent({
  name: "App",
  components: {
    AppButton,
    AppDialog,
    ChatComponent,
    DocumentManager,
    EditorComponent,
    EmptyTaskState,
    ProjectTree,
    ProjectOverview,
    TaskTabs,
    WorkspaceManager,
    WorkspaceMenu,
  },
  data() {
    return {
      tasks: [] as OpenTask[],
      activeTaskId: "",
      workspaces: [] as WorkspaceRecord[],
      activeWorkspace: null as WorkspaceRecord | null,
      workspaceMenuOpen: true,
      projectOverview: false,
      documentManager: "" as "" | "memory" | "notes",
      finishTaskName: "",
      lightMode: false,
      chatPaneWidth: 0,
      editorPaneWidth: 0,
      panelResize: null as null | {
        kind: "workspace" | "right";
        startX: number;
        startWidth: number;
        startEditorWidth: number;
        startTreeWidth: number;
        container: HTMLElement;
        handle: HTMLElement;
        pointerId: number;
      },
      removeEventListener: undefined as (() => void) | undefined,
      removeInteractionListener: undefined as (() => void) | undefined,
      removeInteractionClearListener: undefined as (() => void) | undefined,
    };
  },
  computed: {
    activeTask(): OpenTask | null {
      return this.tasks.find((task) => task.id === this.activeTaskId) ?? null;
    },
    taskActionBusy(): string {
      return this.activeTask?.actionBusy ?? "";
    },
    chatGridClass(): string {
      const count = this.activeTask?.chats.length ?? 0;
      if (count === 1) return "single";
      if (count === 2) return "two";
      return "many";
    },
    workspaceGridStyle(): Record<string, string> {
      return this.chatPaneWidth > 0
        ? { gridTemplateColumns: `${this.chatPaneWidth}px 12px minmax(0, 1fr)` }
        : {};
    },
    rightPaneGridStyle(): Record<string, string> {
      return this.editorPaneWidth > 0
        ? { gridTemplateColumns: `${this.editorPaneWidth}px 12px minmax(0, 1fr)` }
        : {};
    },
  },
  async mounted() {
    this.lightMode = localStorage.getItem("hardcode-theme") === "light";
    this.applyTheme();
    this.removeEventListener = window.hardcode?.chat.onEvent(this.handleChatEvent);
    this.removeInteractionListener = window.hardcode?.chat.onInteraction(this.handleInteraction);
    this.removeInteractionClearListener = window.hardcode?.chat.onInteractionClear(
      this.clearInteraction,
    );
    try {
      this.workspaces = (await window.hardcode?.workspace.list()) ?? [];
    } catch {
      this.workspaces = [];
    }
  },
  beforeUnmount() {
    this.stopPanelResize();
    this.removeEventListener?.();
    this.removeInteractionListener?.();
    this.removeInteractionClearListener?.();
    this.closeAllChats();
  },
  methods: {
    startPanelResize(kind: "workspace" | "right", event: PointerEvent) {
      const handle = event.currentTarget as HTMLElement;
      const container = handle.closest(kind === "workspace" ? ".workspace" : ".right-pane-content") as HTMLElement | null;
      const rightContent = kind === "right"
        ? container
        : container?.querySelector<HTMLElement>(".right-pane-content");
      const panel = container?.querySelector<HTMLElement>(kind === "workspace" ? ".chat-pane" : ".editor-pane");
      const editor = rightContent?.querySelector<HTMLElement>(".editor-pane");
      const tree = rightContent?.querySelector<HTMLElement>(".project-tree");
      if (!container || !panel || !editor || !tree) return;

      this.stopPanelResize();
      this.panelResize = {
        kind,
        startX: event.clientX,
        startWidth: panel.getBoundingClientRect().width,
        startEditorWidth: editor.getBoundingClientRect().width,
        startTreeWidth: tree.getBoundingClientRect().width,
        container,
        handle,
        pointerId: event.pointerId,
      };
      handle.setPointerCapture(event.pointerId);
      window.addEventListener("pointermove", this.resizePanels);
      window.addEventListener("pointerup", this.stopPanelResize);
      window.addEventListener("pointercancel", this.stopPanelResize);
    },
    resizePanels(event: PointerEvent) {
      const resize = this.panelResize;
      if (!resize || event.pointerId !== resize.pointerId) return;
      const minimumPanelWidth = 220;
      const minimumOtherWidth = resize.kind === "workspace"
        ? minimumPanelWidth + resize.startTreeWidth
        : minimumPanelWidth;
      const maximumWidth = Math.max(
        minimumPanelWidth,
        resize.container.getBoundingClientRect().width - 12 - minimumOtherWidth,
      );
      const width = Math.min(maximumWidth, Math.max(minimumPanelWidth, resize.startWidth + event.clientX - resize.startX));
      if (resize.kind === "workspace") {
        this.chatPaneWidth = width;
        this.editorPaneWidth = Math.max(minimumPanelWidth, resize.startEditorWidth - (width - resize.startWidth));
      } else this.editorPaneWidth = width;
    },
    stopPanelResize(event?: PointerEvent) {
      const resize = this.panelResize;
      if (!resize || (event && event.pointerId !== resize.pointerId)) return;
      if (resize.handle.hasPointerCapture(resize.pointerId)) resize.handle.releasePointerCapture(resize.pointerId);
      this.panelResize = null;
      window.removeEventListener("pointermove", this.resizePanels);
      window.removeEventListener("pointerup", this.stopPanelResize);
      window.removeEventListener("pointercancel", this.stopPanelResize);
    },
    allChats() {
      return this.tasks.flatMap((task) => task.chats);
    },
    findChat(chatId: string) {
      return this.allChats().find((chat) => chat.id === chatId);
    },
    clearToolErrors(chat: OpenChat) {
      chat.entries = chat.entries.filter((entry) => entry.kind !== "tool" || entry.status !== "error");
    },
    mountDisabledReason(task: OpenTask) {
      if (task.actionBusy) return "Another task action is running.";
      if (task.mounted) return "Restore the original project and stop live updates.";
      if (task.overlayState === "checking") return "Checking the task overlay…";
      if (task.overlayState === "error") return task.overlayIssue || "The overlay could not be checked.";
      if (task.overlayIssue) return task.overlayIssue;
      if (task.mountedTask) return `Unmount “${task.mountedTask.taskName}” and mount this task.`;
      if (task.overlayState === "clean") return "Mount this task now and project future changes live.";
      return "Project this task into the original project and keep it updated live.";
    },
    completeDisabledReason(task: OpenTask) {
      if (task.actionBusy) return "Another task action is running.";
      if (task.overlayState === "checking") return "Checking the task overlay…";
      if (task.overlayState === "error") return task.overlayIssue || "The overlay could not be checked.";
      if (task.overlayIssue) return task.overlayIssue;
      if (task.mounted) return "Keep the mounted changes in the original project and complete this task.";
      return "Apply this task directly, then continue working or archive it.";
    },
    acknowledgeCompletedTask(task: OpenTask | null) {
      if (
        task &&
        task.chats.some((chat) => chat.hasActivity || chat.entries.length > 0) &&
        task.chats.every((chat) => !chat.running && chat.interactions.length === 0)
      ) {
        task.completionSeen = true;
        task.updatedAt = new Date().toISOString();
      }
    },
    taskRecord(task: OpenTask): WorkspaceTaskRecord {
      return {
        id: task.id,
        name: task.name,
        chats: task.chats.map((chat) => ({
          id: chat.id,
          ...(chat.sessionFile ? { sessionFile: chat.sessionFile } : {}),
          hasActivity: chat.hasActivity,
        })),
        selectedFilePath: task.selectedFilePath,
        readPaths: [...task.readPaths],
        completionSeen: task.completionSeen,
        ...(task.completedAt ? { completedAt: task.completedAt } : {}),
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      };
    },
    async persistTasks() {
      if (!this.activeWorkspace || !window.hardcode) return;
      const records = this.tasks.map((task) => this.taskRecord(task));
      await window.hardcode.workspace.saveTasks(this.activeWorkspace.id, records);
      this.activeWorkspace.tasks = records;
    },
    async refreshTaskOverlayState(task: OpenTask) {
      if (!this.activeWorkspace || !window.hardcode) return;
      const workspaceId = this.activeWorkspace.id;
      const requestId = ++task.overlayRequestId;
      try {
        const status = await window.hardcode.task.status(workspaceId, task.id);
        if (
          requestId !== task.overlayRequestId ||
          this.activeWorkspace?.id !== workspaceId ||
          !this.tasks.includes(task)
        ) {
          return;
        }
        task.overlayState = status.hasChanges ? "dirty" : "clean";
        task.overlayIssue = status.issue ?? "";
        task.mounted = status.mounted;
        task.mountedTask = status.mountedTask;
      } catch (error) {
        if (requestId !== task.overlayRequestId || !this.tasks.includes(task)) return;
        task.overlayState = "error";
        task.overlayIssue = error instanceof Error ? error.message : String(error);
      }
    },
    async startChat(task: OpenTask, chat: OpenChat) {
      if (chat.started || !this.activeWorkspace) return;
      if (!window.hardcode) {
        chat.startError = "Electron bridge unavailable.";
        chat.entries.push({ id: crypto.randomUUID(), kind: "error", content: chat.startError });
        return;
      }
      chat.started = true;
      chat.startError = "";
      try {
        const result = await window.hardcode.chat.start(
          chat.id,
          this.activeWorkspace.id,
          task.id,
          chat.sessionFile,
        );
        chat.sessionFile = result.sessionFile;
        chat.ready = result.ready;
        chat.model = result.model;
        chat.commands = result.commands;
        chat.hasOlderHistory = (result as typeof result & { hasMore: boolean }).hasMore;
        if (result.entries.length) {
          chat.entries = result.entries;
          chat.historyBaselineEntryId = result.entries[0]?.id ?? "";
          chat.hasActivity = true;
        }
        await this.persistTasks();
      } catch (error) {
        chat.started = false;
        chat.ready = false;
        chat.startError = error instanceof Error ? error.message : String(error);
        chat.entries.push({
          id: crypto.randomUUID(),
          kind: "error",
          content: chat.startError,
        });
      }
    },
    async loadOlderChatHistory(chat: OpenChat) {
      if (chat.loadingOlderHistory || !chat.hasOlderHistory || !window.hardcode) return;
      const firstEntry = chat.entries[0];
      const match = firstEntry?.id.match(/^history-(\d+)$/);
      if (!match) { chat.hasOlderHistory = false; return; }
      chat.loadingOlderHistory = true;
      try {
        const historyApi = window.hardcode.chat as typeof window.hardcode.chat & {
          history(chatId: string, before: number): Promise<{ entries: ChatEntry[]; hasMore: boolean }>;
        };
        const result = await historyApi.history(chat.id, Number(match[1]));
        if (result.entries.length) chat.entries = [...result.entries, ...chat.entries];
        chat.hasOlderHistory = result.hasMore;
      } catch {
        // Keep the cursor available so a transient IPC failure can be retried by scrolling again.
      } finally {
        chat.loadingOlderHistory = false;
      }
    },
    unloadOlderChatHistory(chat: OpenChat) {
      const baselineIndex = chat.entries.findIndex(({ id }) => id === chat.historyBaselineEntryId);
      if (baselineIndex <= 0) return;
      chat.entries = chat.entries.slice(baselineIndex);
      chat.hasOlderHistory = true;
    },
    async startTaskChats(task: OpenTask) {
      await Promise.all(task.chats.map((chat) => this.startChat(task, chat)));
    },
    async addChat() {
      const task = this.activeTask;
      if (!task) return;
      const chat = newChat();
      task.chats.push(chat);
      await this.persistTasks();
      await this.startChat(task, chat);
    },
    async branchChat(source: OpenChat) {
      const task = this.activeTask;
      if (!task || source.running || !window.hardcode) return;
      const chat = newChat();
      try {
        const result = await window.hardcode.chat.branch(source.id, chat.id);
        chat.sessionFile = result.sessionFile;
        chat.entries = source.entries.map((entry) => ({ ...entry }));
        chat.hasActivity = chat.entries.length > 0;
        task.chats.push(chat);
        await this.persistTasks();
        await this.startChat(task, chat);
      } catch (error) {
        source.entries.push({
          id: crypto.randomUUID(),
          kind: "error",
          content: error instanceof Error ? error.message : String(error),
        });
      }
    },
    async branchTask() {
      const source = this.activeTask;
      if (!source || source.chats.some((chat) => chat.running) || !this.activeWorkspace || !window.hardcode) return;
      source.actionBusy = "branch";
      source.actionError = "";
      try {
        const record = await window.hardcode.task.branch(this.activeWorkspace.id, source.id);
        const task = openTask(record);
        this.tasks.push(task);
        this.activeWorkspace.tasks = this.tasks.map((candidate) => this.taskRecord(candidate));
        this.activeTaskId = task.id;
        this.projectOverview = false;
        await this.refreshTaskOverlayState(task);
        await this.startTaskChats(task);
      } catch (error) {
        source.actionError = error instanceof Error ? error.message : String(error);
      } finally {
        source.actionBusy = "";
      }
    },
    closeChat(id: string) {
      const task = this.activeTask;
      if (!task) return;
      void window.hardcode?.chat.close(id);
      task.chats = task.chats.filter((chat) => chat.id !== id);
      void this.persistTasks();
    },
    closeAllChats() {
      for (const chat of this.allChats()) {
        if (chat.started) void window.hardcode?.chat.close(chat.id);
      }
      this.tasks = [];
    },
    applyTheme() {
      document.documentElement.dataset.theme = this.lightMode ? "light" : "dark";
    },
    toggleLightMode() {
      this.lightMode = !this.lightMode;
      localStorage.setItem("hardcode-theme", this.lightMode ? "light" : "dark");
      this.applyTheme();
    },
    minimizeWindow() {
      void window.hardcode?.window.minimize();
    },
    toggleWindowMaximize() {
      void window.hardcode?.window.toggleMaximize();
    },
    closeWindow() {
      void window.hardcode?.window.close();
    },
    toggleWorkspaceMenu() {
      if (!this.activeWorkspace) {
        this.workspaceMenuOpen = true;
        return;
      }
      this.workspaceMenuOpen = !this.workspaceMenuOpen;
    },
    openProjectOverview() {
      this.projectOverview = true;
      this.workspaceMenuOpen = false;
    },
    async openWorkspace(workspace: WorkspaceRecord) {
      if (this.activeWorkspace?.id === workspace.id) {
        this.workspaceMenuOpen = false;
        return;
      }
      this.closeAllChats();
      this.activeWorkspace = workspace;
      this.tasks = (workspace.tasks ?? []).filter((task) => !task.completedAt).map(openTask);
      this.activeTaskId = this.tasks[0]?.id ?? "";
      this.projectOverview = true;
      this.workspaceMenuOpen = false;
    },
    manageWorkspaces() {
      this.closeAllChats();
      this.activeTaskId = "";
      this.activeWorkspace = null;
      this.workspaceMenuOpen = true;
    },
    workspaceCreated(workspace: WorkspaceRecord) {
      this.workspaces.push(workspace);
      void this.openWorkspace(workspace);
    },
    async createTask(name: string) {
      if (!this.activeWorkspace) return;
      this.acknowledgeCompletedTask(this.activeTask);
      const now = new Date().toISOString();
      const task: OpenTask = {
        id: crypto.randomUUID(),
        name,
        chats: [newChat()],
        selectedFilePath: "",
        readPaths: [],
        selectedFile: null,
        rightView: "full",
        treeRevision: 0,
        overlayState: "clean",
        overlayIssue: "",
        overlayRequestId: 0,
        mounted: false,
        mountedTask: undefined,
        actionBusy: "",
        actionError: "",
        pendingAction: "",
        completionSeen: false,
        createdAt: now,
        updatedAt: now,
      };
      this.tasks.push(task);
      this.activeTaskId = task.id;
      this.projectOverview = false;
      try {
        await this.persistTasks();
        await this.startTaskChats(task);
      } catch (error) {
        task.chats[0]?.entries.push({
          id: crypto.randomUUID(),
          kind: "error",
          content: error instanceof Error ? error.message : String(error),
        });
      }
    },
    async activateTask(taskId: string) {
      const task = this.tasks.find((candidate) => candidate.id === taskId);
      if (!task) return;
      const previousTask = this.activeTask;
      if (previousTask?.id !== task.id) {
        previousTask?.chats.forEach((chat) => this.unloadOlderChatHistory(chat));
        this.acknowledgeCompletedTask(previousTask);
        void this.persistTasks();
      }
      this.activeTaskId = task.id;
      this.projectOverview = false;
      void (async () => {
        await this.refreshTaskOverlayState(task);
        if (this.activeTask?.id !== task.id) return;
        task.treeRevision += 1;
        if (task.selectedFilePath) await this.loadProjectFile(task, task.selectedFilePath);
      })();
      await this.startTaskChats(task);
      if (task.selectedFilePath && !task.selectedFile) {
        await this.loadProjectFile(task, task.selectedFilePath);
      }
    },
    async setRightView(view: WorkspaceDiffMode) {
      const task = this.activeTask;
      if (!task || task.rightView === view) return;
      task.rightView = view;
      if (task.selectedFilePath) await this.loadProjectFile(task, task.selectedFilePath);
    },
    async loadProjectFile(task: OpenTask, filePath: string) {
      if (!this.activeWorkspace) return;
      try {
        const file = await window.hardcode?.workspace.readFile(
          this.activeWorkspace.id,
          filePath,
          task.id,
          task.rightView,
        );
        if (file && task.selectedFilePath === filePath) task.selectedFile = file;
      } catch (error) {
        if (task.selectedFilePath !== filePath) return;
        task.selectedFile = {
          path: filePath,
          content: `Could not open file:\n\n${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
    async saveProjectFile(content: string) {
      const task = this.activeTask;
      const file = task?.selectedFile;
      if (!task || !file || file.status === "deleted" || !this.activeWorkspace || !window.hardcode) return;
      const originalContent = file.originalContent ?? file.content;
      file.content = content;
      if (file.status !== "added") {
        file.originalContent = originalContent;
        file.status = content === originalContent ? undefined : "modified";
      }
      try {
        await window.hardcode.workspace.writeFile(this.activeWorkspace.id, file.path, task.id, content);
        task.treeRevision += 1;
        await this.refreshTaskOverlayState(task);
      } catch (error) {
        task.actionError = error instanceof Error ? error.message : String(error);
      }
    },
    async resolveProjectConflict(content: string) {
      const task = this.activeTask;
      const file = task?.selectedFile;
      const conflict = file?.mergeConflict;
      if (!task || !file || !conflict || !this.activeWorkspace || !window.hardcode) return;
      task.actionError = "";
      try {
        await window.hardcode.workspace.resolveConflict(
          this.activeWorkspace.id,
          file.path,
          task.id,
          content,
          conflict.revision,
        );
        task.treeRevision += 1;
        await this.refreshTaskOverlayState(task);
        await this.loadProjectFile(task, file.path);
      } catch (error) {
        task.actionError = error instanceof Error ? error.message : String(error);
        await this.loadProjectFile(task, file.path);
      }
    },
    async revertProjectFile() {
      const task = this.activeTask;
      const file = task?.selectedFile;
      if (!task || !file || file.status !== "modified" || typeof file.originalContent !== "string" || !this.activeWorkspace || !window.hardcode) return;
      task.actionError = "";
      try {
        await window.hardcode.workspace.writeFile(this.activeWorkspace.id, file.path, task.id, file.originalContent);
        task.treeRevision += 1;
        await this.refreshTaskOverlayState(task);
        await this.loadProjectFile(task, file.path);
      } catch (error) {
        task.actionError = error instanceof Error ? error.message : String(error);
      }
    },
    async restoreProjectFile() {
      const task = this.activeTask;
      const file = task?.selectedFile;
      if (!task || !file || file.status !== "deleted" || !this.activeWorkspace || !window.hardcode) return;
      task.actionError = "";
      try {
        await window.hardcode.workspace.restoreFile(this.activeWorkspace.id, file.path, task.id);
        task.treeRevision += 1;
        await this.refreshTaskOverlayState(task);
        await this.loadProjectFile(task, file.path);
      } catch (error) {
        task.actionError = error instanceof Error ? error.message : String(error);
      }
    },
    async selectProjectFile(node: ProjectTreeNodeRecord) {
      const task = this.activeTask;
      if (!task || node.type !== "file") return;
      task.selectedFilePath = node.path;
      task.updatedAt = new Date().toISOString();
      void this.persistTasks();
      await this.loadProjectFile(task, node.path);
    },
    async openToolFile(chat: OpenChat, toolPath: string) {
      const task = this.tasks.find((candidate) => candidate.chats.includes(chat));
      if (!task || !this.activeWorkspace || !toolPath) return;
      const requestedPath = toolPath.includes(" → ") ? toolPath.split(" → ").at(-1)!.trim() : toolPath;
      const isAbsolute = /^(?:[A-Za-z]:[\\/]|\/)/.test(requestedPath);
      const normalized = requestedPath.replace(/\\/g, "/");
      const folder = isAbsolute
        ? this.activeWorkspace.folders.find((candidate) => normalized.startsWith(candidate.path.replace(/\\/g, "/").replace(/\/+$/, "") + "/"))
        : this.activeWorkspace.folders.length === 1 ? this.activeWorkspace.folders[0] : undefined;
      if (!folder) return;
      const filePath = isAbsolute
        ? requestedPath
        : `${folder.path.replace(/[\\/]+$/, "")}\\${requestedPath.replace(/^[\\/]+/, "")}`;
      task.selectedFilePath = filePath;
      task.updatedAt = new Date().toISOString();
      void this.persistTasks();
      await this.loadProjectFile(task, filePath);
    },
    async toggleTaskMount() {
      const task = this.activeTask;
      if (!task || !this.activeWorkspace || !window.hardcode) return;
      task.actionBusy = "mount";
      task.actionError = "";
      try {
        if (task.mounted) await window.hardcode.task.unmount(this.activeWorkspace.id, task.id);
        else await window.hardcode.task.mount(this.activeWorkspace.id, task.id);
        await Promise.all(this.tasks.map((candidate) => this.refreshTaskOverlayState(candidate)));
        for (const candidate of this.tasks) candidate.treeRevision += 1;
        if (task.selectedFilePath) await this.loadProjectFile(task, task.selectedFilePath);
      } catch (error) {
        task.actionError = error instanceof Error ? error.message : String(error);
        await this.refreshTaskOverlayState(task);
      } finally {
        task.actionBusy = "";
      }
    },
    async removeActiveTask() {
      const task = this.activeTask;
      if (!task || !this.activeWorkspace || !window.hardcode) return;
      task.pendingAction = "";
      task.actionBusy = "remove";
      task.actionError = "";
      try {
        const removedIndex = this.tasks.indexOf(task);
        await window.hardcode.task.remove(this.activeWorkspace.id, task.id);
        this.tasks = this.tasks.filter((candidate) => candidate.id !== task.id);
        this.activeWorkspace.tasks = this.tasks.map((candidate) => this.taskRecord(candidate));
        const nextTask = this.tasks[Math.min(removedIndex, this.tasks.length - 1)] ?? null;
        this.activeTaskId = nextTask?.id ?? "";
        if (nextTask) await this.activateTask(nextTask.id);
      } catch (error) {
        task.actionError = error instanceof Error ? error.message : String(error);
      } finally {
        task.actionBusy = "";
      }
    },
    async finishActiveTask(archive: boolean) {
      const task = this.activeTask;
      if (!task || !this.activeWorkspace || !window.hardcode) return;
      task.pendingAction = "";
      task.actionBusy = "finish";
      task.actionError = "";
      try {
        const removedIndex = this.tasks.indexOf(task);
        const result = await window.hardcode.task.complete(this.activeWorkspace.id, task.id, {
          archive,
          ...(!archive && this.finishTaskName.trim() ? { name: this.finishTaskName.trim() } : {}),
        });
        task.name = result.name;
        task.mounted = false;
        task.mountedTask = undefined;
        task.overlayState = "clean";
        task.overlayIssue = "";
        task.rightView = "full";
        task.treeRevision += 1;
        task.completionSeen = false;
        this.finishTaskName = "";

        if (archive) {
          await Promise.allSettled(
            task.chats.filter((chat) => chat.started).map((chat) => window.hardcode!.chat.close(chat.id)),
          );
          task.completedAt = new Date().toISOString();
          this.tasks = this.tasks.filter((candidate) => candidate.id !== task.id);
          this.activeWorkspace.tasks = [...this.tasks.map((candidate) => this.taskRecord(candidate)), this.taskRecord(task)];
          const nextTask = this.tasks[Math.min(removedIndex, this.tasks.length - 1)] ?? null;
          this.activeTaskId = nextTask?.id ?? "";
          if (nextTask) await this.activateTask(nextTask.id);
          return;
        }

        this.activeWorkspace.tasks = this.tasks.map((candidate) => this.taskRecord(candidate));
        await Promise.all(this.tasks.map((candidate) => this.refreshTaskOverlayState(candidate)));
        if (task.selectedFilePath) await this.loadProjectFile(task, task.selectedFilePath);
      } catch (error) {
        task.actionError = error instanceof Error ? error.message : String(error);
        await this.refreshTaskOverlayState(task);
      } finally {
        task.actionBusy = "";
      }
    },
    deleteTask() {
      if (this.activeTask) this.activeTask.pendingAction = "delete";
    },
    completeTask() {
      if (this.activeTask) {
        this.finishTaskName = "";
        this.activeTask.pendingAction = "complete";
      }
    },
    cancelTaskRemoval() {
      if (this.activeTask) this.activeTask.pendingAction = "";
      this.finishTaskName = "";
    },
    confirmTaskRemoval() {
      const task = this.activeTask;
      if (task?.pendingAction !== "delete") return;
      task.pendingAction = "";
      void this.removeActiveTask();
    },
    async sendMessage(chat: OpenChat, content: string) {
      const commandName = content.trim().match(/^\/(\S+)/)?.[1]?.toLowerCase();
      const isLocalCommand = !!commandName && chat.commands.some((command) => command.source === "hardcode" && command.name.toLowerCase() === commandName);
      const task = this.tasks.find((candidate) => candidate.chats.includes(chat));
      if (task && !isLocalCommand) task.completionSeen = false;
      if (!isLocalCommand) {
        this.clearToolErrors(chat);
        chat.entries.push({ id: crypto.randomUUID(), kind: "user", content });
        chat.hasActivity = true;
        chat.running = true;
      }
      void this.persistTasks();
      try {
        await window.hardcode?.chat.send(chat.id, content);
      } catch (error) {
        chat.running = false;
        chat.entries.push({
          id: crypto.randomUUID(),
          kind: "error",
          content: error instanceof Error ? error.message : String(error),
        });
      }
    },
    async answerInteraction(chat: OpenChat, payload: InteractionAnswer) {
      try {
        await window.hardcode?.chat.respond(chat.id, payload.id, payload.response);
      } catch (error) {
        chat.entries.push({
          id: crypto.randomUUID(),
          kind: "error",
          content: error instanceof Error ? error.message : String(error),
        });
      }
    },
    abortChat(chat: OpenChat) {
      void window.hardcode?.chat.abort(chat.id);
    },
    async openExternal(chat: OpenChat, url: string) {
      try {
        await window.hardcode?.chat.openExternal(url);
      } catch (error) {
        chat.entries.push({
          id: crypto.randomUUID(),
          kind: "error",
          content: error instanceof Error ? error.message : String(error),
        });
      }
    },
    handleInteraction(payload: ChatInteractionPayload) {
      const chat = this.findChat(payload.chatId);
      if (chat) chat.interactions.push(payload.interaction);
    },
    clearInteraction(payload: ChatInteractionClearPayload) {
      const chat = this.findChat(payload.chatId);
      if (chat) chat.interactions = chat.interactions.filter(({ id }) => id !== payload.id);
    },
    handleChatEvent(payload: ChatEventPayload) {
      const chat = this.findChat(payload.chatId);
      if (!chat) return;

      if (payload.type === "files-read") {
        const task = this.tasks.find((candidate) => candidate.chats.includes(chat));
        if (task) {
          const paths = new Set(task.readPaths);
          for (const filePath of payload.paths ?? []) paths.add(filePath);
          task.readPaths = [...paths];
          void this.persistTasks();
        }
      } else if (payload.type === "ready") {
        chat.ready = true;
        chat.model = payload.model ?? null;
        chat.commands = payload.commands ?? [];
      } else if (payload.type === "state") {
        chat.running = Boolean(payload.running);
        if (chat.running) {
          chat.thought = "";
          const task = this.tasks.find((candidate) => candidate.chats.includes(chat));
          if (task) task.completionSeen = false;
        } else {
          chat.thought = "";
          const task = this.tasks.find((candidate) => candidate.chats.includes(chat));
          if (task) {
            task.treeRevision += 1;
            void this.refreshTaskOverlayState(task);
            if (task.selectedFilePath) void this.loadProjectFile(task, task.selectedFilePath);
          }
        }
      } else if (payload.type === "model") {
        chat.model = payload.model ?? null;
      } else if (payload.type === "assistant-start") {
        this.clearToolErrors(chat);
        chat.entries.push({ id: payload.messageId!, kind: "assistant", content: "" });
      } else if (payload.type === "assistant-delta") {
        if (payload.thought) chat.thought = (payload.delta ?? "").replace(/\*\*/g, "");
        else {
          const entry = chat.entries.find(({ id }) => id === payload.messageId);
          if (entry) entry.content += payload.delta ?? "";
        }
      } else if (payload.type === "assistant-end") {
        let entry = chat.entries.find(({ id }) => id === payload.messageId);
        if (!entry) {
          entry = { id: payload.messageId!, kind: "assistant", content: "" };
          chat.entries.push(entry);
        }
        entry.content = payload.content ?? entry.content;
      } else if (payload.type === "tool-start") {
        chat.entries.push({
          id: payload.toolCallId!,
          kind: "tool",
          title: payload.name,
          input: payload.input,
          content: "",
          status: "running",
        });
      } else if (payload.type === "tool-update" || payload.type === "tool-end") {
        const entry = chat.entries.find(({ id }) => id === payload.toolCallId);
        if (!entry) return;
        entry.content = payload.content ?? entry.content;
        if (payload.type === "tool-end") {
          entry.status = payload.isError ? "error" : "done";
          if (!payload.isError) this.clearToolErrors(chat);
          const task = this.tasks.find((candidate) => candidate.chats.includes(chat));
          if (task) {
            task.treeRevision += 1;
            void this.refreshTaskOverlayState(task);
          }
        }
      } else if (payload.type === "status" || payload.type === "error") {
        chat.entries.push({
          id: crypto.randomUUID(),
          kind: payload.type,
          content: payload.content ?? "",
        });
      }
    },
  },
});
</script>

<style scoped>
.app { position: relative; display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100%; }
.app > header { padding: 12px; }
.app-header { z-index: 30; display: flex; gap: 10px; align-items: center; min-height: 33px; border-bottom: 1px solid var(--basic-border-subtle); background: var(--color-background); -webkit-app-region: drag; }
.app-header :deep(.app-button), .app-header input { -webkit-app-region: no-drag; }
.hamburger-button { flex-direction: column; gap: 4px; }
.hamburger-button span { width: 14px; height: 1px; background: currentColor; }
.icon-control-button.app-button { display: flex; align-items: center; justify-content: center; font-size: 20px; }
.right-pane { display: grid; grid-template-rows: auto minmax(0, 1fr); min-width: 0; min-height: 0; }
.right-pane-tabs { display: flex; gap: 3px; align-items: center; min-height: 32px; padding: 6px 5px; }
.right-pane-content { display: grid; grid-template-columns: minmax(0, 1fr) 12px minmax(220px, 300px); min-width: 0; min-height: 0; }
.diff-dot { display: inline-block; width: 6px; height: 6px; margin-left: 6px; border-radius: 50%; background: var(--feature-diff-modified); vertical-align: middle; }

.active-workspace-name.app-button { flex: 0 0 auto; max-width: 180px; min-width: 0; padding: 6px 9px; overflow: hidden; color: var(--color-text); font: 13px/1.2 system-ui, sans-serif; text-overflow: ellipsis; white-space: nowrap; }
.document-controls { display: flex; flex: 0 0 auto; gap: 4px; }
.window-controls { display: flex; flex: 0 0 auto; gap: 4px; margin-left: auto; }
.window-control.app-button { border-color: transparent; background: transparent; font-size: 16px; }
.window-minimize-control.app-button { font-size: 12px; }
.window-control.app-button:hover { border-color: #405b7d; background: #1c2a3d; }
.window-close-control.app-button:hover { border-color: #b84f58; background: #6c2730; }
.workspace-manager-view { min-width: 0; min-height: 0; margin-left: 280px; }
.workspace { display: grid; grid-template-columns: minmax(220px, 1fr) 12px minmax(440px, 1fr); grid-template-rows: minmax(0, 1fr) auto; row-gap: 12px; min-width: 0; min-height: 0; padding: 0 12px 12px; }.project-overview-view { grid-column: 1 / -1; grid-row: 1 / -1; }
.task-actions { display: flex; grid-column: 1 / -1; gap: 8px; justify-content: flex-end; align-items: center; min-width: 0; padding-top: 2px; font: 12px/1.3 system-ui, sans-serif; }
.task-actions .delete-task-button { order: -2; margin-right: 0; }
.task-actions .branch-task-button { order: -1; margin-right: auto; }
.task-action-error { min-width: 0; overflow: hidden; color: var(--state-error); text-overflow: ellipsis; white-space: nowrap; }
.finish-task-name { display: grid; gap: 7px; margin-top: 16px; color: var(--basic-text-content); }
.finish-task-name small { color: var(--color-text-secondary); font-weight: 400; }
.finish-task-name input { box-sizing: border-box; width: 100%; border: 1px solid var(--color-border-strong); border-radius: 7px; padding: 8px 10px; color: var(--color-text); outline: none; background: var(--color-panel); font: inherit; }
.finish-task-name input:focus { border-color: var(--basic-border-focus); box-shadow: 0 0 0 2px var(--state-action); }

.panel-resize-handle {
  position: relative;
  z-index: 1;
  cursor: col-resize;
  touch-action: none;
}
.panel-resize-handle::after {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 5px;
  width: 2px;
  border-radius: 2px;
  background: var(--basic-border-focus);
  content: "";
  opacity: 0;
  transition: opacity 120ms ease;
}
.panel-resize-handle:hover::after,
.panel-resize-handle:focus-visible::after,
.panel-resize-handle:active::after { opacity: 1; }

.chat-pane {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.task-chat-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 32px;
  padding: 6px 5px;
  color: var(--color-text-secondary);
  font: 12px/1.2 system-ui, sans-serif;
}

.chat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  width: 100%;
  min-height: 0;
  overflow-y: auto;
}

.chat-grid.single { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
.chat-grid.two { grid-template-rows: minmax(0, 1fr); }
.chat-grid.many { grid-auto-rows: 45vh; align-content: start; }
</style>
