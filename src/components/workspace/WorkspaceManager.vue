<template>
  <section class="workspace-manager">
    <div class="workspace-manager-content">
      <div class="workspace-manager-heading">
        <h1>New workspace</h1>
        <label class="theme-switch">
          <span>Light mode</span>
          <input
            type="checkbox"
            role="switch"
            :checked="lightMode"
            aria-label="Toggle light mode"
            @change="$emit('toggle-light-mode')"
          />
        </label>
      </div>
      <p>A workspace groups the folders and repositories that belong to one product.</p>

      <form @submit.prevent="createWorkspace">
        <label class="workspace-field">
          <span>Name</span>
          <input v-model="name" type="text" placeholder="My workspace" autofocus />
        </label>

        <div class="workspace-folders-heading">
          <span>Folders</span>
          <AppButton type="button" @click="pickFolders">Add folders</AppButton>
        </div>

        <div v-if="folders.length" class="workspace-folder-list">
          <div v-for="(folder, index) in folders" :key="folder.path" class="workspace-folder-row">
            <div class="workspace-folder-path" :title="folder.path">{{ folder.path }}</div>
            <label>
              <span>Default branch</span>
              <input v-model="folder.defaultBranch" type="text" placeholder="main" />
            </label>
            <AppButton size="control" variant="subtle" type="button" aria-label="Remove folder" @click="removeFolder(index)">×</AppButton>
          </div>
        </div>
        <p v-else class="workspace-empty-folders">No folders added.</p>

        <p v-if="error" class="workspace-form-error">{{ error }}</p>

        <div class="workspace-form-actions">
          <AppButton type="submit" :disabled="saving || !name.trim() || folders.length === 0">
            {{ saving ? "Creating…" : "Create workspace" }}
          </AppButton>
        </div>
      </form>
    </div>
  </section>
</template>

<script lang="ts">
import AppButton from "../ui/AppButton.vue";
import { defineComponent } from "vue";

export default defineComponent({
  name: "WorkspaceManager",
  components: { AppButton },
  emits: ["created", "toggle-light-mode"],
  props: {
    lightMode: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      name: "",
      folders: [] as WorkspaceFolder[],
      saving: false,
      error: "",
    };
  },
  methods: {
    async pickFolders() {
      this.error = "";
      try {
        const paths = (await window.hardcode?.workspace.pickFolders()) ?? [];
        const existing = new Set(this.folders.map((folder) => folder.path.toLowerCase()));
        for (const folderPath of paths) {
          if (!existing.has(folderPath.toLowerCase())) {
            this.folders.push({ path: folderPath, defaultBranch: "main" });
            existing.add(folderPath.toLowerCase());
          }
        }
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    removeFolder(index: number) {
      this.folders.splice(index, 1);
    },
    async createWorkspace() {
      if (!window.hardcode || this.saving || !this.name.trim() || this.folders.length === 0) return;
      this.saving = true;
      this.error = "";
      try {
        const workspace = await window.hardcode.workspace.create({
          name: this.name,
          folders: this.folders.map((folder) => ({
            path: folder.path,
            defaultBranch: folder.defaultBranch,
          })),
        });
        this.$emit("created", workspace);
        this.name = "";
        this.folders = [];
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style scoped>
.workspace-manager { overflow-y: auto; color: var(--color-text); background: var(--color-background); font: 14px/1.5 system-ui, sans-serif; }
.workspace-manager-content { width: min(760px, calc(100% - 48px)); margin: 0 auto; padding: 48px 0; }
.workspace-manager-heading { display: flex; justify-content: space-between; gap: 16px; align-items: center; }
.workspace-manager h1 { margin: 0; color: var(--basic-text-heading); font-size: 24px; }
.workspace-manager-content > p { margin: 8px 0 28px; color: var(--color-text-secondary); }
.theme-switch { display: inline-flex; gap: 8px; align-items: center; color: var(--basic-text-label); font-size: 12px; white-space: nowrap; cursor: pointer; }
.theme-switch input { position: relative; width: 34px; height: 18px; margin: 0; appearance: none; border: 1px solid var(--basic-border-hover); border-radius: 999px; outline-offset: 2px; background: var(--color-elevated-strong); cursor: pointer; transition: background .15s, border-color .15s; }
.theme-switch input::after { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--basic-text-light); content: ""; transition: transform .15s; }
.theme-switch input:checked { border-color: var(--state-action-border); background: var(--state-action); }
.theme-switch input:checked::after { transform: translateX(16px); }
.workspace-field, .workspace-folder-row label { display: grid; gap: 6px; color: var(--basic-text-label); font-size: 12px; }
.workspace-field input, .workspace-folder-row input { box-sizing: border-box; width: 100%; padding: 9px 10px; border: 1px solid var(--color-border-strong); border-radius: 7px; outline: none; color: var(--color-text); background: var(--color-panel); font: 14px/1.4 system-ui, sans-serif; }
.workspace-field input:focus, .workspace-folder-row input:focus { border-color: var(--basic-border-focus); }
.workspace-folders-heading { display: flex; justify-content: space-between; align-items: center; margin-top: 24px; color: var(--basic-text-heading); font-weight: 600; }
.workspace-folder-list { display: grid; gap: 8px; margin-top: 10px; }
.workspace-folder-row { display: grid; grid-template-columns: minmax(0, 1fr) 160px auto; gap: 12px; align-items: end; padding: 11px; border: 1px solid var(--color-border); border-radius: 9px; background: var(--color-panel); }
.workspace-folder-path { align-self: center; overflow: hidden; color: var(--basic-content); text-overflow: ellipsis; white-space: nowrap; }
.workspace-folder-row > .app-button { width: 34px; height: 34px; }
.workspace-empty-folders { margin: 10px 0 0; padding: 18px; border: 1px dashed var(--color-border-strong); border-radius: 9px; color: var(--color-text-secondary); text-align: center; }
.workspace-form-error { color: var(--state-error); }
.workspace-form-actions { display: flex; justify-content: flex-end; margin-top: 20px; }
</style>
