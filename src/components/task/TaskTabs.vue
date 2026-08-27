<template>
  <nav class="task-tabs" aria-label="Tasks">
    <AppButton
      v-for="task in tasks"
      :key="task.id"
      class="task-tab"
      size="small"
      :active="task.id === activeTaskId"
      type="button"
      :title="task.name"
      @click="$emit('select', task.id)"
    >
      <span class="task-status-light" :class="statusFor(task)" aria-hidden="true"></span>
      <span v-if="task.mounted" class="task-mounted-indicator" aria-label="Mounted">▶</span>
      <span class="task-tab-name">{{ task.name }}</span>
    </AppButton>

    <form v-if="creating" class="task-create-form" @submit.prevent="submit">
      <input
        ref="nameInput"
        v-model="name"
        autofocus
        type="text"
        aria-label="Task name"
        placeholder="Task name"
        @keydown.esc.prevent="cancel"
      />
      <AppButton type="submit" :disabled="!name.trim()">OK</AppButton>
    </form>
    <AppButton
      v-else
      class="task-add-button"
      size="icon"
      type="button"
      aria-label="Add task"
      title="Add task"
      @click="begin"
    >
      +
    </AppButton>
  </nav>
</template>

<script lang="ts">
import AppButton from "../ui/AppButton.vue";
import { defineComponent, nextTick, type PropType } from "vue";

interface TaskTab extends WorkspaceTaskRecord {
  mounted: boolean;
  chats: Array<WorkspaceTaskChatRecord & {
    entries: ChatEntry[];
    interactions: ChatInteraction[];
    running: boolean;
  }>;
}

export default defineComponent({
  name: "TaskTabs",
  emits: ["select", "create"],
  components: { AppButton },
  props: {
    tasks: { type: Array as PropType<TaskTab[]>, required: true },
    activeTaskId: { type: String, default: "" },
  },
  data() {
    return { creating: false, name: "" };
  },
  methods: {
    statusFor(task: TaskTab) {
      if (task.chats.some((chat) => chat.interactions.length > 0)) return "attention";
      if (task.chats.some((chat) => chat.running)) return "working";
      if (
        !task.completionSeen &&
        task.chats.some((chat) => chat.hasActivity || chat.entries.length > 0)
      ) {
        return "complete";
      }
      return "idle";
    },
    focusNameInput() {
      const input = this.$refs.nameInput as HTMLInputElement | undefined;
      if (!input) return;
      input.focus();
      input.select();
    },
    begin() {
      this.creating = true;
      this.name = "";
      // A task can disappear while its chat is being closed. Focus again after
      // that render cycle so the newly displayed field is immediately usable.
      void nextTick(() => {
        this.focusNameInput();
        requestAnimationFrame(() => this.focusNameInput());
      });
    },
    cancel() {
      this.creating = false;
      this.name = "";
    },
    submit() {
      const name = this.name.trim();
      if (!name) {
        this.focusNameInput();
        return;
      }
      this.$emit("create", name);
      this.cancel();
    },
  },
});
</script>

<style scoped>
.task-tabs { display: flex; flex: 1 1 auto; gap: 5px; align-items: center; min-width: 0; overflow-x: auto; font: 12px/1.2 system-ui, sans-serif; }
.task-tab.app-button, .task-create-form .app-button { flex: 0 0 auto; height: 30px; }
.task-add-button.app-button { width: 30px; height: 30px; }
.task-tab { display: flex; gap: 7px; align-items: center; max-width: 190px; padding: 0 10px; }
.task-tab.app-button.app-button-active,
.task-tab.app-button.app-button-active:hover { border-color: var(--basic-border-focus); background: var(--color-elevated); }
.task-tab-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-mounted-indicator { flex: 0 0 auto; color: var(--color-text); font-size: 10px; line-height: 1; }
.task-status-light { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: var(--state-idle); }
.task-status-light.working { background: var(--state-warning); box-shadow: 0 0 6px rgb(211 167 47 / 45%); }
.task-status-light.complete { background: var(--state-success); }
.task-status-light.attention { background: var(--state-attention); box-shadow: 0 0 6px rgb(224 92 99 / 55%); }
.task-create-form { display: flex; flex: 0 0 auto; gap: 5px; align-items: center; }
.task-create-form input { box-sizing: border-box; width: 180px; height: 30px; padding: 0 9px; border: 1px solid var(--color-border-strong); border-radius: 7px; outline: none; color: var(--color-text); background: var(--color-panel); font: inherit; }
.task-create-form input:focus { border-color: var(--basic-border-focus); }
</style>
