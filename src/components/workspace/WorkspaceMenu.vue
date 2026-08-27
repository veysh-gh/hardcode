<template>
  <aside class="workspace-menu" :class="{ pinned }">
    <div class="workspace-menu-heading">
      <span>Workspaces</span>
      <AppButton v-if="!pinned" size="icon" variant="subtle" type="button" aria-label="Close workspace menu" @click="$emit('close')">
        ×
      </AppButton>
    </div>

    <nav class="workspace-menu-list" aria-label="Workspaces">
      <AppButton
        v-for="workspace in workspaces"
        :key="workspace.id"
        type="button"
        variant="subtle"
        class="workspace-menu-item"
        :active="workspace.id === activeWorkspaceId"
        @click="$emit('select', workspace)"
      >
        <span>{{ workspace.name }}</span>
        <small>{{ workspace.folders.length }} folder{{ workspace.folders.length === 1 ? "" : "s" }}</small>
      </AppButton>
    </nav>

    <AppButton class="manage-workspaces-button" variant="subtle" type="button" @click="$emit('manage')">
      + New workspace
    </AppButton>
  </aside>
</template>

<script lang="ts">
import AppButton from "../ui/AppButton.vue";
import { defineComponent, type PropType } from "vue";

export default defineComponent({
  name: "WorkspaceMenu",
  emits: ["close", "manage", "select"],
  components: { AppButton },
  props: {
    workspaces: { type: Array as PropType<WorkspaceRecord[]>, required: true },
    activeWorkspaceId: { type: String, default: "" },
    pinned: { type: Boolean, default: false },
  },
});
</script>

<style scoped>
.workspace-menu { position: absolute; top: 57px; bottom: 0; left: 0; z-index: 20; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; width: 280px; border-right: 1px solid var(--color-border); color: var(--color-text); background: var(--color-panel); box-shadow: 12px 0 32px var(--overlay-shadow-panel); font: 13px/1.4 system-ui, sans-serif; }
.workspace-menu.pinned { box-shadow: none; }
.workspace-menu-heading { display: flex; justify-content: space-between; align-items: center; padding: 15px 14px 10px; color: var(--basic-text-heading); font-weight: 600; }
.workspace-menu-list { min-height: 0; padding: 4px 8px; overflow-y: auto; }
.workspace-menu-item { display: grid; width: 100%; padding: 9px 10px; border-radius: 7px; text-align: left; }
.workspace-menu-item:hover { background: var(--color-elevated); }
.workspace-menu-item small { margin-top: 2px; color: var(--color-text-secondary); }
.manage-workspaces-button.app-button { margin: 8px; padding: 10px; border-top: 1px solid var(--color-border); text-align: left; }
</style>
