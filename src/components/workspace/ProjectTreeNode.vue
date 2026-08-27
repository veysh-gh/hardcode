<template>
  <li class="project-tree-node">
    <AppButton
      size="small"
      variant="subtle"
      type="button"
      class="project-tree-row"
      :active="isSelected"
      :class="node.status ? `change-${node.status}` : ''"
      :style="{ paddingLeft: `${10 + depth * 14}px` }"
      :title="node.path"
      @click="activate"
    >
      <span class="project-tree-caret">
        {{ node.type === "directory" ? (node.expanded ? "▾" : "▸") : "" }}
      </span>
      <span class="project-tree-node-name">{{ node.name }}</span>
      <span v-if="wasRead" class="project-tree-read" title="Read by agent" aria-label="Read by agent">👁</span>
      <small v-if="node.meta">{{ node.meta }}</small>
    </AppButton>

    <p v-if="node.loading" class="project-tree-state" :style="{ paddingLeft: `${28 + depth * 14}px` }">
      Loading…
    </p>
    <p v-else-if="node.error" class="project-tree-state error" :style="{ paddingLeft: `${28 + depth * 14}px` }">
      {{ node.error }}
    </p>

    <ul v-if="node.type === 'directory' && node.expanded && node.children">
      <ProjectTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :selected-path="selectedPath"
        :read-paths="readPaths"
        @select="$emit('select', $event)"
        @toggle="$emit('toggle', $event)"
      />
    </ul>
  </li>
</template>

<script lang="ts">
import AppButton from "../ui/AppButton.vue";
import { defineComponent, type PropType } from "vue";

export default defineComponent({
  name: "ProjectTreeNode",
  emits: ["select", "toggle"],
  components: { AppButton },
  props: {
    node: { type: Object as PropType<ProjectTreeNodeRecord>, required: true },
    depth: { type: Number, default: 0 },
    selectedPath: { type: String, default: "" },
    readPaths: { type: Array as PropType<string[]>, default: () => [] },
  },
  computed: {
    isSelected(): boolean {
      return this.node.type === "file" && this.node.path.replace(/\\/g, "/").toLowerCase() === this.selectedPath.replace(/\\/g, "/").toLowerCase();
    },
    wasRead(): boolean {
      return this.node.type === "file" && this.readPaths.includes(this.node.path);
    },
  },
  methods: {
    activate() {
      if (this.node.type === "directory") this.$emit("toggle", this.node);
      else this.$emit("select", this.node);
    },
  },
});
</script>
