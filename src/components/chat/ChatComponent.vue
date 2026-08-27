<template>
  <article class="chat-card">
    <header class="chat-header">
      <span>Chat</span>
      <AppButton v-if="startError" class="retry-chat-button" size="small" variant="danger" type="button" :title="startError" @click="$emit('retry')">Retry</AppButton>

      <AppButton class="icon-control-button close-chat-button" size="icon" variant="subtle" type="button" aria-label="Close chat" title="Close chat" @click="$emit('close')">×</AppButton>
    </header>

    <div ref="messagesElement" class="chat-messages" aria-live="polite" @scroll="handleMessagesScroll">
      <div v-if="loadingOlder" class="history-loader" role="status"><span class="history-spinner" aria-hidden="true"></span>Loading older messages…</div>
      <template v-for="item in displayItems" :key="item.id">
        <div v-if="item.kind === 'user' || item.kind === 'assistant'" class="chat-message markdown-body" :class="`chat-message-${item.kind}`" v-html="renderMarkdown(item.content)" @click="handleMarkdownClick"></div>
        <div v-else-if="item.kind === 'tool-group' && (item.category === 'read' || isCompactToolGroup(item))" class="tool-activity">
          <template v-if="isReadGroup(item)">
            <span>{{ readToolLabel(item) }} </span>
            <template v-for="(entry, index) in item.entries" :key="entry.id">
              <button v-if="isToolFile(entry)" class="tool-path-link" type="button" :title="toolPath(entry)" @click="$emit('open-file', toolPath(entry))">{{ shortToolPath(entry) }}</button>
              <span v-else :class="{ 'tool-path-text': hasToolPath(entry) }">{{ hasToolPath(entry) ? shortToolPath(entry) : entry.title }}</span><span v-if="index < item.entries.length - 1">{{ pathSeparator(index, item.entries.length) }}</span>
            </template>
          </template>
          <template v-else-if="isDiffGroup(item)">
            <span>Reading changes<span v-if="item.entries.some((entry) => hasToolPath(entry))"> in </span></span>
            <template v-for="(entry, index) in item.entries" :key="entry.id">
              <button v-if="isToolFile(entry)" class="tool-path-link" type="button" :title="toolPath(entry)" @click="$emit('open-file', toolPath(entry))">{{ shortToolPath(entry) }}</button>
              <span v-else-if="hasToolPath(entry)" class="tool-path-text">{{ shortToolPath(entry) }}</span><span v-if="index < item.entries.length - 1">{{ pathSeparator(index, item.entries.length) }}</span>
            </template>
          </template>
          <template v-else-if="isDeleteGroup(item)">
            <span>Deleting </span>
            <template v-for="(entry, index) in item.entries" :key="entry.id">
              <button v-if="isToolFile(entry)" class="tool-path-link" type="button" :title="toolPath(entry)" @click="$emit('open-file', toolPath(entry))">{{ shortToolPath(entry) }}</button>
              <span v-else :class="{ 'tool-path-text': hasToolPath(entry) }">{{ hasToolPath(entry) ? shortToolPath(entry) : entry.title }}</span><span v-if="index < item.entries.length - 1">{{ pathSeparator(index, item.entries.length) }}</span>
            </template>
          </template>
          <span v-else>Reading status</span>
          <span v-if="item.running" class="tool-activity-status">Running…</span>
        </div>
        <details v-else-if="item.kind === 'tool-group' && item.category !== 'read'" class="tool-entry" :class="{ failed: item.failed }">
          <summary>
            <span class="tool-group-title">{{ item.title }} </span>
            <template v-for="(entry, index) in item.entries" :key="entry.id">
              <button v-if="isToolFile(entry)" class="tool-path-link" type="button" :title="toolPath(entry)" @click.stop="$emit('open-file', toolPath(entry))">{{ shortToolPath(entry) }}</button>
              <span v-else :class="{ 'tool-path-text': hasToolPath(entry) }">{{ hasToolPath(entry) ? shortToolPath(entry) : entry.title }}</span><span v-if="toolExplanation(entry)" class="tool-explanation"> — {{ toolExplanation(entry) }}</span><span v-if="index < item.entries.length - 1">{{ pathSeparator(index, item.entries.length) }}</span>
            </template>
            <span v-if="item.running" class="tool-group-status">Running…</span>
          </summary>
          <div class="tool-group-content">
            <section v-for="entry in item.entries" :key="entry.id" class="tool-call-section" :class="{ failed: entry.status === 'error' }">
              <div class="tool-call-heading">
                <span>{{ toolPath(entry) }}</span>
                <span v-if="entry.status === 'running' || entry.status === 'error'" class="tool-call-status">{{ entry.status === "running" ? "Running…" : "error" }}</span>
              </div>
              <MiniDiffViewer v-if="toolDiff(entry)" :preview="toolDiff(entry)!" />
              <pre v-else-if="entry.input" class="tool-code tool-arguments-code" v-html="highlight(entry.input, item.category, true)"></pre>
              <pre v-if="entry.content && (!toolDiff(entry) || entry.status === 'error')" class="tool-code" v-html="highlight(entry.content, item.category, false)"></pre>
            </section>
          </div>
        </details>
        <p v-else class="chat-status" :class="{ error: item.kind === 'error' }">{{ item.content }}</p>
      </template>
      <AppButton v-if="entries.length && !running && ready" class="branch-chat-button" size="icon" variant="subtle" type="button" title="Branch from this conversation" aria-label="Branch from this conversation" @click="$emit('branch')">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><circle cx="6" cy="5" r="2" stroke="currentColor" stroke-width="2" /><circle cx="18" cy="7" r="2" stroke="currentColor" stroke-width="2" /><circle cx="18" cy="19" r="2" stroke="currentColor" stroke-width="2" /><path d="M6 7v7a5 5 0 0 0 5 5h5M11 7h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
      </AppButton>
      <div v-if="running || workComplete" class="chat-work-status" :class="{ complete: workComplete }">
        <span v-if="running" class="work-spinner" aria-hidden="true"></span>
        <span v-if="running">{{ workingMessage }}</span>
        <span v-if="running && thought" class="work-thought">{{ thought }}</span>
        <span v-else-if="!running">Worked for {{ formatDuration(elapsedMs) }}</span>
        <span class="work-duration">{{ formatDuration(elapsedMs) }}</span>
      </div>

    </div>

    <InteractionHost v-if="interactions.length" :interactions="interactions" @answer="$emit('answer', $event)" @abort="$emit('abort')" @open-link="$emit('open-link', $event)" />
    <form class="chat-composer" @submit.prevent="sendMessage">
      <SlashCommandMenu v-if="showSlashMenu" :commands="filteredCommands" :completions="filteredCompletions" :active-index="activeCommandIndex" @select="selectCommand" @select-completion="selectCompletion" />
      <div class="chat-composer-field">
        <textarea ref="composerElement" v-model="draft" rows="2" aria-label="Message" :placeholder="ready ? 'Message Pi' : startError ? 'Pi failed to start — draft retained' : 'Starting Pi… You can already type'" @keydown="handleComposerKeydown"></textarea>
        <div class="chat-composer-footer">
          <span class="chat-agent" :title="model ? model.name || model.id : ''">Agent: {{ model ? model.name || model.id : ready ? "No model selected" : "Starting Pi…" }}</span>
          <AppButton v-if="running" class="composer-action stop-button" type="button" aria-label="Stop" title="Stop" @click="$emit('abort')">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          </AppButton>
          <AppButton v-else class="send-button composer-action" type="submit" :disabled="!ready || !draft.trim()" aria-label="Send message" title="Send message">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M4 12h15M13 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </AppButton>
        </div>
      </div>
    </form>
  </article>
</template>

<script lang="ts">
import MarkdownIt from "markdown-it";
import AppButton from "../ui/AppButton.vue";
import MiniDiffViewer from "../editor/MiniDiffViewer.vue";
import type { DiffPreview } from "../editor/code-diff";
import { defineComponent, nextTick, type PropType } from "vue";

const markdown = new MarkdownIt({ breaks: true, linkify: true });
markdown.linkify.set({ fuzzyLink: false });
import InteractionHost from "./InteractionHost.vue";
import SlashCommandMenu from "./SlashCommandMenu.vue";

type ToolGroup = { id: string; kind: "tool-group"; entries: ChatEntry[]; category: "read" | "write" | "other"; title: string; failed: boolean; running: boolean };

type DisplayItem = ChatEntry | ToolGroup;

export default defineComponent({
  name: "ChatComponent",
  components: { AppButton, InteractionHost, MiniDiffViewer, SlashCommandMenu },
  emits: ["close", "branch", "send", "answer", "abort", "open-link", "open-file", "retry", "load-older"],
  props: {
    entries: { type: Array as PropType<ChatEntry[]>, required: true },
    interactions: { type: Array as PropType<ChatInteraction[]>, required: true },
    ready: { type: Boolean, default: false }, startError: { type: String, default: "" }, running: { type: Boolean, default: false }, thought: { type: String, default: "" },
    hasOlder: { type: Boolean, default: false }, loadingOlder: { type: Boolean, default: false },
    model: { type: Object as PropType<ChatModel | null>, default: null }, commands: { type: Array as PropType<ChatCommand[]>, default: () => [] }, chatId: { type: String, required: true },
  },
  data() {
    return {
      draft: "", activeCommandIndex: 0, slashMenuDismissed: false, completions: [] as ChatCompletion[], completionRequest: 0,
      workStartedAt: 0, elapsedMs: 0, workComplete: false,
      workingMessage: "", workTimer: null as ReturnType<typeof setInterval> | null,
      olderScrollHeight: 0,
      olderFirstEntryId: "",
      wasNearBottom: true,
    };
  },
  mounted() { this.resizeComposer(); window.addEventListener("resize", this.resizeComposer); this.scrollToBottom(true); if (this.running) this.startWork(); },
  beforeUnmount() { window.removeEventListener("resize", this.resizeComposer); this.stopWorkTimer(); },
  computed: {
    slashQuery(): string | null { if (!this.draft.startsWith("/") || /\s/.test(this.draft)) return null; return this.draft.slice(1).toLowerCase(); },
    commandArguments(): { command: string; prefix: string } | null { const match = this.draft.match(/^\/([^\s]+)\s+(.*)$/s); return match ? { command: match[1]!, prefix: match[2]! } : null; },
    filteredCommands(): ChatCommand[] { if (this.slashQuery === null) return []; return this.commands.filter((command) => `${command.name} ${command.description ?? ""}`.toLowerCase().includes(this.slashQuery!)); },
    filteredCompletions(): ChatCompletion[] { return this.commandArguments ? this.completions : []; },
    showSlashMenu(): boolean { return !this.slashMenuDismissed && (this.filteredCommands.length > 0 || this.filteredCompletions.length > 0); },
    displayItems(): DisplayItem[] {
      const result: DisplayItem[] = [];
      for (const entry of this.entries) {
        if (entry.kind === "assistant" && !entry.content.trim()) continue;
        if (entry.kind !== "tool") { result.push(entry); continue; }
        const category = this.toolCategory(entry.title);
        const compactName = this.compactToolName(entry);
        const canBundle = category === "read" || ["diff", "status", "delete"].includes(compactName);
        const previous = result[result.length - 1] as ToolGroup | undefined;
        if (canBundle && previous?.kind === "tool-group" && previous.category === category && this.compactToolName(previous.entries[0]!) === compactName) previous.entries.push(entry);
        else result.push({ id: `tool-group-${entry.id}`, kind: "tool-group", entries: [entry], category, title: "", failed: false, running: false });
      }
      for (const item of result) if (item.kind === "tool-group") { item.failed = item.entries.some((entry) => entry.status === "error"); item.running = item.entries.some((entry) => entry.status === "running"); item.title = this.toolTitle(item); }
      return result;
    },
  },
  watch: {
    draft() { this.activeCommandIndex = 0; this.slashMenuDismissed = false; void this.loadCompletions(); void nextTick(() => this.resizeComposer()); },
    entries: { deep: true, handler() {
      if (this.olderScrollHeight && this.entries[0]?.id !== this.olderFirstEntryId) {
        void nextTick(() => {
          const element = this.$refs.messagesElement as HTMLElement | undefined;
          if (element) element.scrollTop += element.scrollHeight - this.olderScrollHeight;
          this.olderScrollHeight = 0;
          this.olderFirstEntryId = "";
        });
      } else this.scrollToBottom();
    } },
    interactions: { deep: true, handler() { this.scrollToBottom(); } },
    running(value: boolean) { if (value) this.startWork(); else if (this.workStartedAt) this.finishWork(); },
  },
  methods: {
    startWork() {
      if (this.workStartedAt) return;
      const messages = ["Vibing", "Cooking", "Yapping", "Noodling", "Snazzifying", "Winging", "Hustling", "Speedrunning", "Maxxing"];
      this.workStartedAt = Date.now();
      this.elapsedMs = 0;
      this.workComplete = false;
      this.workingMessage = messages[Math.floor(Math.random() * messages.length)] ?? messages[0];
      this.stopWorkTimer();
      this.workTimer = setInterval(() => { this.elapsedMs = Date.now() - this.workStartedAt; }, 250);
      this.scrollToBottom();
    },
    finishWork() {
      if (!this.workStartedAt) return;
      this.elapsedMs = Date.now() - this.workStartedAt;
      this.workStartedAt = 0;
      this.workComplete = true;
      this.stopWorkTimer();
      this.scrollToBottom();
    },
    stopWorkTimer() { if (this.workTimer) { clearInterval(this.workTimer); this.workTimer = null; } },
    formatDuration(milliseconds: number) {
      const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return minutes ? `${minutes}m ${seconds.toString().padStart(2, "0")}s` : `${seconds}s`;
    },
    toolCategory(name = ""): "read" | "write" | "other" { const value = name.toLowerCase(); if (/read|get|list|search|glob|grep|find/.test(value)) return "read"; if (/write|edit|patch|delete|create|mkdir|move|revert/.test(value)) return "write"; return "other"; },
    toolTitle(group: ToolGroup) {
      const tool = this.toolName(group.entries[0]!);
      if (tool === "write") return "Wrote";
      if (tool === "edit") return "Edited";
      if (tool === "move") return "Moved";
      if (tool === "revert") return "Reverted";
      return group.category === "read" ? "Read" : "Ran";
    },
    toolPath(entry: ChatEntry) {
      try {
        const input = JSON.parse(entry.input ?? "") as { path?: unknown; file?: unknown; filename?: unknown; source?: unknown; destination?: unknown };
        const path = input.path ?? input.file ?? input.filename;
        if (typeof path === "string") return path;
        if (typeof input.source === "string" && typeof input.destination === "string") return `${input.source} → ${input.destination}`;
        return entry.title ?? "Tool call";
      } catch {
        const match = entry.input?.match(/(?:path|file|filename)["']?\s*[:=]\s*["']([^"']+)/i);
        return match?.[1] ?? entry.title ?? "Tool call";
      }
    },
    hasToolPath(entry: ChatEntry) {
      try {
        const input = JSON.parse(entry.input ?? "") as { path?: unknown; file?: unknown; filename?: unknown; source?: unknown; destination?: unknown };
        return typeof (input.path ?? input.file ?? input.filename) === "string" || (typeof input.source === "string" && typeof input.destination === "string");
      } catch {
        return /(?:path|file|filename)["']?\s*[:=]\s*["']/.test(entry.input ?? "");
      }
    },
    shortToolPath(entry: ChatEntry) { const path = this.toolPath(entry); if (path.includes(" → ")) return path; const normalized = path.replace(/[\\/]+$/, ""); return normalized.split(/[\\/]/).pop() || path; },
    isToolFile(entry: ChatEntry) {
      if (!this.hasToolPath(entry)) return false;
      if (/^(read|write|edit|delete|move|diff)$/.test(this.toolName(entry))) return true;
      return /\.[^\\/.\s]+$/.test(this.toolPath(entry));
    },
    toolExplanation(entry: ChatEntry) {
      try {
        const input = JSON.parse(entry.input ?? "") as { explanation?: unknown };
        return typeof input.explanation === "string" ? input.explanation.trim() : "";
      } catch { return ""; }
    },
    toolName(entry: ChatEntry) { return entry.title?.trim().toLowerCase().split(/[.:/\\]/).pop() ?? ""; },
    isToolNamed(entry: ChatEntry, name: string) { return this.toolName(entry) === name; },
    compactToolName(entry: ChatEntry) {
      const category = this.toolCategory(entry.title);
      if (category === "read" || category === "write") return this.toolName(entry);
      return ["diff", "status"].find((name) => this.isToolNamed(entry, name)) ?? "";
    },
    isReadGroup(group: ToolGroup) { return group.category === "read"; },
    readToolLabel(group: ToolGroup) {
      const name = this.toolName(group.entries[0]!);
      if (/^(grep|search)$/.test(name)) return "Searching";
      if (/^(find|glob)$/.test(name)) return "Finding";
      if (/^(ls|list)$/.test(name)) return "Listing";
      return "Reading";
    },
    isDiffGroup(group: ToolGroup) { return group.entries.every((entry) => this.isToolNamed(entry, "diff")); },
    isStatusGroup(group: ToolGroup) { return group.entries.every((entry) => this.isToolNamed(entry, "status")); },
    isDeleteGroup(group: ToolGroup) { return group.entries.every((entry) => this.isToolNamed(entry, "delete")); },
    isCompactToolGroup(group: ToolGroup) { return this.isReadGroup(group) || this.isDiffGroup(group) || this.isStatusGroup(group) || this.isDeleteGroup(group); },
    pathSeparator(index: number, count: number) { return index === count - 2 ? "\u00a0and\u00a0" : ",\u00a0"; },
    toolDiff(entry: ChatEntry): DiffPreview | null {
      if (!/^(write|edit)$/.test(this.toolName(entry))) return null;
      try {
        const input = JSON.parse(entry.input ?? "") as { path?: unknown; content?: unknown; edits?: unknown };
        if (typeof input.path !== "string") return null;
        if (typeof input.content === "string") return { path: input.path, original: "", content: input.content };
        if (!Array.isArray(input.edits)) return null;
        const edits = input.edits.filter((edit): edit is { oldText: string; newText: string } =>
          typeof edit?.oldText === "string" && typeof edit?.newText === "string",
        );
        if (!edits.length) return null;
        return {
          path: input.path,
          original: edits.map((edit) => edit.oldText).join("\n"),
          content: edits.map((edit) => edit.newText).join("\n"),
        };
      } catch { return null; }
    },
    escapeHtml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
    renderMarkdown(value: string) { return markdown.render(value); },
    handleMarkdownClick(event: MouseEvent) {
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
      if (!link) return;
      event.preventDefault();
      this.$emit("open-link", link.href);
    },
    highlight(value: string, category: string, input: boolean) {
      let html = this.escapeHtml(value);
      if (category === "write" && !input) html = html.split("\n").map((line) => `<span class="diff-line ${line.startsWith("+") ? "added" : line.startsWith("-") ? "removed" : ""}">${line || " "}</span>`).join("\n");
      else html = html.replace(/(\/\/.*|#.*)$/gm, '<span class="code-comment">$1</span>').replace(/(&quot;.*?&quot;|&#39;.*?&#39;)/g, '<span class="code-string">$1</span>').replace(/\b(const|let|var|function|return|import|from|export|if|else|for|class|new|true|false|null)\b/g, '<span class="code-keyword">$1</span>');
      return html;
    },
    handleMessagesScroll() {
      const element = this.$refs.messagesElement as HTMLElement | undefined;
      if (!element) return;
      this.wasNearBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 30;
      if (!this.hasOlder || this.loadingOlder || element.scrollTop > 80) return;
      this.olderScrollHeight = element.scrollHeight;
      this.olderFirstEntryId = this.entries[0]?.id ?? "";
      this.$emit("load-older");
    },
    resizeComposer() {
      const element = this.$refs.composerElement as HTMLTextAreaElement | undefined;
      if (!element) return;
      element.style.height = "auto";
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 21;
      const maxHeight = lineHeight * 10 + 18;
      element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
      element.style.overflowY = element.scrollHeight > maxHeight ? "auto" : "hidden";
    },
    sendMessage() { const content = this.draft.trim(); if (!content || !this.ready) return; this.draft = ""; this.$emit("send", content); },
    selectCommand(command: ChatCommand) { this.draft = `/${command.name} `; void nextTick(() => { (this.$refs.composerElement as HTMLTextAreaElement | undefined)?.focus(); }); },
    selectCompletion(option: ChatCompletion) { const context = this.commandArguments; if (!context) return; this.draft = `/${context.command} ${option.value}`; void nextTick(() => { this.slashMenuDismissed = true; (this.$refs.composerElement as HTMLTextAreaElement | undefined)?.focus(); }); },
    async loadCompletions() { const request = ++this.completionRequest; const context = this.commandArguments; if (!context || !window.hardcode) { this.completions = []; return; } try { const result = await window.hardcode.chat.complete(this.chatId, context.command, context.prefix); if (request === this.completionRequest) this.completions = result; } catch { if (request === this.completionRequest) this.completions = []; } },
    handleComposerKeydown(event: KeyboardEvent) {
      if (this.showSlashMenu) { if (event.key === "ArrowDown") { event.preventDefault(); const count = this.filteredCompletions.length || this.filteredCommands.length; this.activeCommandIndex = (this.activeCommandIndex + 1) % count; return; } if (event.key === "ArrowUp") { event.preventDefault(); const count = this.filteredCompletions.length || this.filteredCommands.length; this.activeCommandIndex = (this.activeCommandIndex - 1 + count) % count; return; } if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); if (this.filteredCompletions.length) { const option = this.filteredCompletions[this.activeCommandIndex]; if (option) this.selectCompletion(option); } else { const command = this.filteredCommands[this.activeCommandIndex]; if (command) this.selectCommand(command); } return; } if (event.key === "Escape") { event.preventDefault(); this.slashMenuDismissed = true; return; } }
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); this.sendMessage(); }
    },
    scrollToBottom(force = false) {
      void nextTick(() => {
        const element = this.$refs.messagesElement as HTMLElement | undefined;
        if (element && (force || this.wasNearBottom)) element.scrollTop = element.scrollHeight;
      });
    },
  },
});
</script>

<style scoped>
.chat-card { position: relative; display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid var(--basic-border-subtle); border-radius: 15px; color: var(--color-text); background: var(--color-panel); font: 14px/1.5 system-ui, sans-serif; }
.chat-header { min-height: 24px; padding: 12px 44px 8px 14px; color: var(--color-text-secondary); font-size: 12px; }
.close-chat-button.app-button { position: absolute; top: 8px; right: 8px; z-index: 2; font-size: 16px; }
.retry-chat-button.app-button { position: absolute; top: 8px; right: 40px; z-index: 2; height: 24px; }
.branch-chat-button.app-button { position: relative; display: grid; place-items: center; width: 28px; height: 28px; margin: -28px 0 0 auto; padding: 5px; }
.branch-chat-button svg { width: 16px; height: 16px; }
.chat-messages { min-height: 0; padding: 8px 16px 0; overflow-y: auto; }
.history-loader { display: flex; justify-content: center; align-items: center; gap: 7px; min-height: 32px; color: var(--basic-text-dim); font-size: 12px; }
.history-spinner { width: 12px; height: 12px; border: 2px solid var(--color-border-strong); border-top-color: var(--accent-spinner); border-radius: 50%; animation: work-spin 800ms linear infinite; }
.chat-message { width: fit-content; max-width: min(80%, 680px); margin-bottom: 12px; padding: 9px 12px; border-radius: 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
.chat-message-user { margin-left: auto; color: var(--color-text); background: var(--color-elevated-strong); }
.chat-message-assistant { padding-left: 0; background: transparent; }
.chat-status { margin: 8px 0; color: var(--color-text-secondary); font-size: 12px; }
.chat-status.error { color: var(--state-error); }
.tool-activity { display: flex; flex-wrap: wrap; gap: 0; align-items: baseline; margin: 8px 0; color: var(--color-text-secondary); font-size: 12px; line-height: 1.5; }
.tool-activity.failed { color: var(--accent-failed-icon); }
.tool-activity > span:first-child { margin-right: 4px; }
.tool-path-link { margin: 0; padding: 0; border: 0; color: var(--feature-link); background: transparent; cursor: pointer; font: inherit; text-decoration: underline; text-underline-offset: 2px; }
.tool-path-link:hover { color: var(--feature-link-hover); }
.tool-path-text { color: var(--color-text-secondary); text-decoration: underline; text-underline-offset: 2px; }
.tool-activity-status { margin-left: 6px; color: var(--basic-text-dim); font-size: 11px; }
.tool-entry { margin: 8px 0; color: var(--color-text-secondary); font-size: 12px; }
.tool-entry summary { display: flex; align-items: baseline; gap: 6px; cursor: pointer; list-style: none; user-select: none; }
.tool-entry summary::-webkit-details-marker { display: none; }
.tool-entry summary::before { display: inline-block; width: 10px; color: var(--accent-info); content: "▸"; transition: transform 120ms ease; }
.tool-entry[open] summary::before { transform: rotate(90deg); }
.tool-group-title { display: flex; flex: 0 0 auto; align-items: center; color: var(--color-text-secondary); white-space: nowrap; }
.tool-group-status { margin-left: 6px; color: var(--basic-text-dim); font-size: 11px; }
.tool-explanation { color: var(--basic-text-dim); }
.tool-call-heading { display: flex; align-items: center; gap: 5px; padding: 0 10px; color: var(--color-text-secondary); font: 11px/1.3 ui-monospace, SFMono-Regular, Consolas, monospace; }
.tool-call-heading > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-call-status { margin-left: auto; flex: none; }
.tool-call-section.failed .tool-call-status { color: var(--accent-failed-icon); }
.tool-group-content { min-width: 0; margin-top: 5px; }
.tool-call-section + .tool-call-section { margin-top: 12px; }
.tool-code { max-height: none; margin: 0; padding: 5px 10px 10px; overflow: visible; color: var(--basic-text-code); white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
.tool-code + .tool-code { padding-top: 8px; border-top: 1px dashed var(--basic-border-muted); }
.code-keyword { color: var(--feature-code-keyword); } .code-string { color: var(--feature-code-string); } .code-comment { color: var(--feature-code-comment); font-style: italic; }
.diff-line { display: block; margin: 0 -10px; padding: 0 10px; } .diff-line.added { color: var(--feature-diff-added); background: var(--overlay-diff-added); } .diff-line.removed { color: var(--feature-diff-removed); background: var(--overlay-diff-removed); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.chat-composer { position: relative; display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; padding: 12px; border-top: 1px solid var(--basic-border-subtle); }
.chat-composer-field { overflow: hidden; border: 1px solid var(--color-border-strong); border-radius: 9px; background: var(--color-background); } .chat-composer-field:focus-within { border-color: var(--basic-border-focus); }
.chat-composer textarea { box-sizing: border-box; width: 100%; min-width: 0; min-height: 60px; max-height: calc(1.5em * 10 + 18px); padding: 9px 11px; resize: none; overflow-y: hidden; border: 0; border-radius: 0; outline: none; color: var(--color-text); background: transparent; font: inherit; line-height: 1.5; }
.chat-composer textarea::placeholder { color: var(--accent-info); opacity: 1; }
.chat-composer-footer { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 38px; padding: 4px 7px 4px 11px; border-top: 1px solid var(--color-border); }
.chat-agent { min-width: 0; overflow: hidden; color: var(--color-text-secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.chat-composer-footer .app-button { margin-left: auto; width: 30px; height: 30px; padding: 0; border: 1px solid var(--color-border-strong); border-radius: 50%; color: var(--color-text); background: var(--color-elevated-strong); cursor: pointer; }
.chat-composer-footer .composer-action { flex: none; display: grid; place-items: center; font-size: 11px; line-height: 1; } .chat-composer-footer .send-button.app-button { width: 30px; height: 30px; } .composer-action svg { width: 16px; height: 16px; }
.chat-work-status { display: flex; gap: 8px; align-items: center; margin: 10px 0 4px; padding: 8px 10px; border: 1px solid var(--color-border-strong); border-radius: 8px; color: var(--basic-text-label); background: var(--color-background); font-size: 12px; } .work-thought { min-width: 0; max-width: 45%; overflow: hidden; color: var(--basic-text-dim); font-style: italic; text-overflow: ellipsis; white-space: nowrap; } .chat-work-status.complete { color: var(--state-success-text); border-color: var(--state-complete-border); } .work-duration { margin-left: auto; color: var(--basic-text-dim); font-variant-numeric: tabular-nums; } .chat-work-status.complete .work-duration { color: inherit; }
.work-spinner { width: 12px; height: 12px; border: 2px solid var(--color-border-strong); border-top-color: var(--accent-spinner); border-radius: 50%; animation: work-spin 800ms linear infinite; } @keyframes work-spin { to { transform: rotate(360deg); } }
.markdown-body { line-height: 1.55; white-space: normal; } .markdown-body p { margin: 0 0 10px; } .markdown-body p:last-child { margin-bottom: 0; } .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 { margin: 0 0 8px; line-height: 1.25; color: var(--feature-markdown-heading); } .markdown-body h1 { font-size: 1.35em; } .markdown-body h2 { font-size: 1.2em; } .markdown-body h3 { font-size: 1.08em; } .markdown-body ul, .markdown-body ol { margin: 0 0 10px; padding-left: 22px; } .markdown-body li { margin: 3px 0; } .markdown-body blockquote { margin: 0 0 10px; padding-left: 12px; border-left: 3px solid var(--feature-markdown-quote); color: var(--feature-markdown-quote-text); } .markdown-body code { padding: 1px 4px; border-radius: 4px; color: var(--feature-markdown-code); background: var(--color-elevated-strong); font: .9em ui-monospace, SFMono-Regular, Consolas, monospace; } .markdown-body pre { margin: 8px 0 12px; padding: 10px 12px; overflow-x: auto; border: 1px solid var(--color-border-strong); border-radius: 7px; background: var(--color-background); } .markdown-body pre code { padding: 0; color: var(--basic-text-code); background: transparent; white-space: pre; } .markdown-body a { color: var(--feature-link); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; } .markdown-body a:hover { color: var(--feature-link-hover); } .chat-message-user.markdown-body p { margin-bottom: 0; }
</style>
