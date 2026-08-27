<template>
  <section class="task-empty-state">
    <div class="task-empty-content">
      <h1>Create your first task</h1>
      <p>What would you like to work on in this workspace?</p>
      <form class="task-empty-form" @submit.prevent="submit">
        <input
          ref="nameInput"
          v-model="name"
          type="text"
          aria-label="Task name"
          placeholder="Task name"
          autofocus
          @keydown.esc.prevent="clear"
        />
        <AppButton size="large" type="submit" :disabled="!name.trim()">OK</AppButton>
      </form>
    </div>
  </section>
</template>

<script lang="ts">
import { defineComponent, nextTick } from "vue";
import AppButton from "../ui/AppButton.vue";

export default defineComponent({
  name: "EmptyTaskState",
  components: { AppButton },
  emits: ["create"],
  data() {
    return { name: "" };
  },
  methods: {
    focusInput() {
      const input = this.$refs.nameInput as HTMLInputElement | undefined;
      input?.focus();
    },
    clear() {
      this.name = "";
      void nextTick(() => this.focusInput());
    },
    submit() {
      const name = this.name.trim();
      if (!name) {
        this.focusInput();
        return;
      }
      this.$emit("create", name);
      this.name = "";
    },
  },
});
</script>

<style scoped>
.task-empty-state { display: grid; place-items: center; min-width: 0; min-height: 0; color: var(--color-text); background: var(--color-background); font: 14px/1.5 system-ui, sans-serif; }
.task-empty-content { width: min(420px, calc(100% - 48px)); padding: 32px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-panel); box-shadow: 0 18px 45px var(--overlay-shadow-card); text-align: center; }
.task-empty-content h1 { margin: 0; color: var(--basic-text-heading); font-size: 21px; font-weight: 600; }
.task-empty-content p { margin: 8px 0 22px; color: var(--color-text-secondary); }
.task-empty-form { display: flex; gap: 8px; align-items: center; }
.task-empty-form input { box-sizing: border-box; flex: 1; min-width: 0; height: 34px; padding: 0 10px; border: 1px solid var(--color-border-strong); border-radius: 7px; outline: none; color: var(--color-text); background: var(--color-background); font: inherit; }
.task-empty-form input:focus { border-color: var(--basic-border-focus); }
</style>
