<template>
  <AppDialog :open="open" :title="title" cancel-label="Close" @cancel="$emit('close')">
    <div class="document-manager">
      <section v-for="group in groups" :key="group.scope" class="document-group">
        <header>
          <strong>{{ group.label }} <span class="document-scope-name">{{ group.name }}</span></strong>
          <AppButton size="small" type="button" @click="newDocument(group.scope)">+ New</AppButton>
        </header>
        <button
          v-for="file in group.files"
          :key="file"
          class="document-entry"
          type="button"
          @click="editDocument(group.scope, file)"
        >{{ file }}</button>
        <span v-if="!group.files.length" class="document-empty">No documents</span>
      </section>
    </div>
  </AppDialog>

  <AppDialog
    :open="Boolean(editor)"
    :title="editor?.path ? `Edit ${editor.path}` : 'New document'"
    cancel-label="Cancel"
    confirm-label="Save"
    @cancel="editor = null"
    @confirm="saveDocument"
  >
    <label class="document-field">
      <span>Filename</span>
      <input v-model="editorPath" type="text" placeholder="document.md" :disabled="Boolean(editor?.existing)" />
    </label>
    <label class="document-field">
      <span>Content</span>
      <textarea v-model="editorContent" rows="14" autofocus />
    </label>
    <p v-if="error" class="document-error">{{ error }}</p>
  </AppDialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import AppButton from "../ui/AppButton.vue";
import AppDialog from "../ui/AppDialog.vue";

type DocumentScope = "task-notes" | "workspace-notes" | "task-memory" | "workspace-memory";
interface Group { scope: DocumentScope; label: string; name: string; files: string[] }

export default defineComponent({
  name: "DocumentManager",
  components: { AppButton, AppDialog },
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, required: true },
    kind: { type: String as PropType<"notes" | "memory">, required: true },
    workspaceId: { type: String, required: true },
    taskId: { type: String, default: "" },
    taskName: { type: String, default: "" },
    workspaceName: { type: String, default: "" },
  },
  emits: ["close"],
  data() {
    return { taskFiles: [] as string[], workspaceFiles: [] as string[], editor: null as { scope: DocumentScope; path: string; existing: boolean } | null, editorPath: "", editorContent: "", error: "" };
  },
  computed: {
    groups(): Group[] {
      return [
        { scope: `task-${this.kind}` as DocumentScope, label: "Task", name: this.taskName, files: this.taskFiles },
        { scope: `workspace-${this.kind}` as DocumentScope, label: "Workspace", name: this.workspaceName, files: this.workspaceFiles },
      ];
    },
  },
  watch: { open(value: boolean) { if (value) void this.load(); } },
  mounted() { if (this.open) void this.load(); },
  methods: {
    async load() {
      const api = window.hardcode?.documents;
      if (!api) return;
      try {
        const [task, workspace] = await Promise.all([
          this.taskId ? api.list(this.workspaceId, this.taskId, `task-${this.kind}` as DocumentScope) : Promise.resolve([]),
          api.list(this.workspaceId, this.taskId, `workspace-${this.kind}` as DocumentScope),
        ]);
        this.taskFiles = task; this.workspaceFiles = workspace; this.error = "";
      } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    },
    newDocument(scope: DocumentScope) { this.editor = { scope, path: "", existing: false }; this.editorPath = ""; this.editorContent = ""; this.error = ""; },
    async editDocument(scope: DocumentScope, file: string) {
      try { this.editorContent = await window.hardcode!.documents.read(this.workspaceId, this.taskId, scope, file); this.editor = { scope, path: file, existing: true }; this.editorPath = file; this.error = ""; }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    },
    async saveDocument() {
      const file = this.editorPath.trim();
      if (!this.editor || !file || file.includes("..") || file.startsWith("/")) { this.error = "Enter a valid relative filename."; return; }
      try { await window.hardcode!.documents.write(this.workspaceId, this.taskId, this.editor.scope, file, this.editorContent); this.editor = null; await this.load(); }
      catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    },
  },
});
</script>

<style scoped>
.document-manager { display: grid; gap: 14px; }
.document-group { display: grid; gap: 5px; }
.document-group > header { display: flex; align-items: center; justify-content: space-between; color: var(--color-text); }
.document-scope-name { margin-left: 4px; color: var(--basic-text-dim); font-weight: 400; }
.document-entry { padding: 7px 9px; border: 1px solid var(--color-border-strong); border-radius: 6px; color: var(--basic-text-content); background: var(--color-elevated-strong); cursor: pointer; text-align: left; font: 12px/1.3 system-ui, sans-serif; }
.document-entry:hover { border-color: var(--basic-border-focus); color: var(--color-text); }
.document-empty { color: var(--basic-text-dim); font-size: 12px; }
.document-field { display: grid; gap: 6px; margin-bottom: 14px; }
.document-field input, .document-field textarea { box-sizing: border-box; width: 100%; padding: 8px; border: 1px solid var(--color-border-strong); border-radius: 6px; outline: none; color: var(--color-text); background: var(--color-panel); font: 13px/1.4 system-ui, sans-serif; resize: vertical; }
.document-field input:focus, .document-field textarea:focus { border-color: var(--basic-border-focus); }
.document-error { color: var(--state-danger-text); }
</style>
