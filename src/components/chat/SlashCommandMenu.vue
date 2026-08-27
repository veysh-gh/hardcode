<template>
  <div class="slash-command-menu" role="listbox" aria-label="Slash commands">
    <AppButton
      v-for="(command, index) in commands"
      :key="`${command.source}:${command.name}`"
      :ref="index === activeIndex ? 'activeCommand' : undefined"
      class="slash-command-option"
      variant="subtle"
      :active="index === activeIndex"
      type="button"
      role="option"
      :aria-selected="index === activeIndex"
      @mousedown.prevent="$emit('select', command)"
    >
      <span>/{{ command.name }}</span>
      <small v-if="command.description">{{ command.description }}</small>
    </AppButton>
    <AppButton
      v-for="(option, index) in completions"
      :key="`completion:${option.value}`"
      :ref="index === activeIndex ? 'activeCommand' : undefined"
      class="slash-command-option"
      variant="subtle"
      :active="index === activeIndex"
      type="button"
      role="option"
      :aria-selected="index === activeIndex"
      @mousedown.prevent="$emit('select-completion', option)"
    >
      <span>{{ option.label }}</span>
      <small>{{ option.description || option.value }}</small>
    </AppButton>
  </div>
</template>

<script lang="ts">
import AppButton from "../ui/AppButton.vue";
import { defineComponent, nextTick, type PropType } from "vue";

export default defineComponent({
  name: "SlashCommandMenu",
  emits: ["select", "select-completion"],
  components: { AppButton },
  props: {
    commands: { type: Array as PropType<ChatCommand[]>, required: true },
    activeIndex: { type: Number, required: true },
    completions: { type: Array as PropType<ChatCompletion[]>, default: () => [] },
  },
  watch: {
    activeIndex() {
      void nextTick(() => {
        const reference = this.$refs.activeCommand;
        const element = Array.isArray(reference) ? reference[0] : reference;
        (element as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
      });
    },
  },
});
</script>

<style scoped>
.slash-command-menu { position: absolute; right: 12px; bottom: calc(100% + 8px); left: 12px; z-index: 10; max-height: min(320px, 45vh); padding: 6px; overflow-y: auto; border: 1px solid var(--color-border-strong); border-radius: 10px; background: var(--color-elevated); box-shadow: 0 12px 32px var(--overlay-shadow-menu); }
.slash-command-option.app-button { display: grid; width: 100%; padding: 8px 10px; text-align: left; }
.slash-command-option.app-button:hover { background: var(--color-elevated-strong); }
.slash-command-option small { margin-top: 2px; color: var(--color-text-secondary); }
</style>
