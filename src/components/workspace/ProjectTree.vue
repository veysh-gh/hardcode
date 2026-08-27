<template>
  <aside class="project-tree">
    <header>Project</header>
    <ul class="project-tree-roots">
      <ProjectTreeNode
        v-for="node in roots"
        :key="node.path"
        :node="node"
        :selected-path="selectedPath"
        :read-paths="readPaths"
        @select="$emit('select', $event)"
        @toggle="toggleDirectory"
      />
    </ul>
  </aside>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import ProjectTreeNode from "./ProjectTreeNode.vue";

export default defineComponent({
  name: "ProjectTree",
  components: { ProjectTreeNode },
  emits: ["select"],
  props: {
    workspace: { type: Object as PropType<WorkspaceRecord>, required: true },
    taskId: { type: String, required: true },
    selectedPath: { type: String, default: "" },
    readPaths: { type: Array as PropType<string[]>, default: () => [] },
    refreshKey: { type: Number, default: 0 },
    diffMode: {
      type: String as PropType<WorkspaceDiffMode>,
      default: "full",
    },
  },
  data() {
    return {
      roots: [] as ProjectTreeNodeRecord[],
      fullExpanded: new Map<string, boolean>(),
      lastMode: this.diffMode as WorkspaceDiffMode,
    };
  },
  watch: {
    workspace: { immediate: true, handler() { this.resetRoots(); } },
    taskId() { this.resetRoots(); },
    refreshKey() { this.rememberFullExpansion(); this.resetRoots(); },
    diffMode() {
      if (this.lastMode === "full") this.rememberFullExpansion();
      this.lastMode = this.diffMode;
      this.resetRoots();
    },
    selectedPath(path: string) { if (path) void this.revealPath(path); },
  },
  methods: {
    rememberFullExpansion() {
      if (this.lastMode !== "full") return;
      const visit = (nodes: ProjectTreeNodeRecord[]) => {
        for (const node of nodes) {
          if (node.type !== "directory") continue;
          this.fullExpanded.set(node.path, node.expanded);
          if (node.children) visit(node.children);
        }
      };
      visit(this.roots);
    },
    makeRoots() {
      return this.workspace.folders.map((folder) => {
        const normalized = folder.path.replace(/[\\/]+$/, "");
        return {
          name: normalized.split(/[\\/]/).pop() || folder.path,
          path: folder.path,
          type: "directory" as const,
          meta: folder.defaultBranch,
          expanded: this.diffMode !== "full" || this.fullExpanded.get(folder.path) !== false,
          loading: false,
          children: null,
        };
      });
    },
    async resetRoots() {
      this.roots = this.makeRoots();
      if (this.diffMode !== "full") {
        await Promise.all(this.roots.map((root) => this.loadDirectory(root, true)));
      } else {
        await Promise.all(this.roots.filter((root) => root.expanded).map((root) => this.loadDirectory(root, true)));
      }
    },
    async loadDirectory(node: ProjectTreeNodeRecord, expandAll = false) {
      if (node.loading || node.children) return;
      node.loading = true;
      node.error = "";
      try {
        const children = await window.hardcode?.workspace.readDirectory(
          this.workspace.id,
          node.path,
          this.taskId,
          this.diffMode,
        );
        const visibleChildren = this.diffMode !== "full"
          ? (children ?? []).filter((child) => child.status)
          : children ?? [];
        node.children = visibleChildren.map((child) => ({
          ...child,
          expanded: this.diffMode !== "full" || this.fullExpanded.get(child.path) === true,
          loading: false,
          children: child.type === "directory" ? null : undefined,
        }));
        if (expandAll) {
          await Promise.all(
            node.children
              .filter((child) => child.type === "directory" && (this.diffMode !== "full" || child.expanded))
              .map((child) => this.loadDirectory(child, true)),
          );
        }
      } catch (error) {
        node.error = error instanceof Error ? error.message : String(error);
        node.expanded = false;
      } finally {
        node.loading = false;
      }
    },
    async revealPath(filePath: string) {
      const normalized = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
      const root = this.roots.find((node) => {
        const rootPath = node.path.replace(/\\/g, "/").replace(/\/+$/, "");
        return normalized === rootPath || normalized.startsWith(`${rootPath}/`);
      });
      if (!root) return;
      root.expanded = true;
      await this.loadDirectory(root);
      const rootPath = root.path.replace(/\\/g, "/").replace(/\/+$/, "");
      const parts = normalized.slice(rootPath.length).split("/").filter(Boolean);
      let node = root;
      for (const part of parts.slice(0, -1)) {
        const child = node.children?.find((candidate) => candidate.name === part && candidate.type === "directory");
        if (!child) return;
        child.expanded = true;
        await this.loadDirectory(child);
        node = child;
      }
    },
    async toggleDirectory(node: ProjectTreeNodeRecord) {
      if (this.diffMode !== "full" || node.loading) return;
      node.expanded = !node.expanded;
      this.fullExpanded.set(node.path, node.expanded);
      if (node.expanded) await this.loadDirectory(node);
    },
  },
});
</script>

<style scoped>
.project-tree { display: grid; grid-template-rows: auto minmax(0, 1fr); min-width: 0; min-height: 0; overflow: hidden; border: 1px solid var(--basic-border-subtle); border-radius: 15px; color: var(--basic-content); background: var(--color-panel); font: 12px/1.35 system-ui, sans-serif; }
.project-tree > header { padding: 10px 12px; border-bottom: 1px solid var(--color-border); color: var(--color-text-secondary); }
.project-tree ul { margin: 0; padding: 0; list-style: none; }
.project-tree :deep(ul) { margin: 0; padding: 0; list-style: none; }
.project-tree-roots { min-height: 0; padding: 6px 0 !important; overflow: auto; }
:deep(.project-tree-row.app-button) { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto auto; gap: 4px; align-items: center; width: 100%; min-height: 27px; padding-top: 4px; padding-right: 8px; padding-bottom: 4px; font: inherit; text-align: left; }
:deep(.project-tree-row.change-added) { color: var(--state-success) !important; }
:deep(.project-tree-row.change-modified) { color: var(--feature-diff-modified) !important; }
:deep(.project-tree-row.change-deleted) { color: var(--state-attention) !important; }
:deep(.project-tree-caret) { color: var(--color-text-secondary); text-align: center; }
:deep(.project-tree-node-name) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
:deep(.project-tree-read) { color: var(--accent-icon); font-size: 12px; line-height: 1; }
:deep(.project-tree-row small) { color: var(--basic-text-muted); }
:deep(.project-tree-state) { margin: 3px 0; color: var(--basic-text-muted); }
:deep(.project-tree-state.error) { color: var(--state-error); }
</style>
