<template>
  <div v-if="interactions.length" class="interaction-list">
    <template v-for="interaction in interactions" :key="interaction.id">
      <SelectInteraction
        v-if="interaction.type === 'select'"
        :interaction="interaction"
        @answer="answer(interaction.id, $event)"
        @cancel="cancel(interaction.id)"
      />
      <MultiSelectInteraction
        v-else-if="interaction.type === 'multi-select'"
        :interaction="interaction"
        @answer="answer(interaction.id, $event)"
        @cancel="cancel(interaction.id)"
      />
      <InputInteraction
        v-else-if="interaction.type === 'input'"
        :interaction="interaction"
        @answer="answer(interaction.id, $event)"
        @cancel="cancel(interaction.id)"
      />
      <ConfirmInteraction
        v-else-if="interaction.type === 'confirm'"
        :interaction="interaction"
        @answer="answer(interaction.id, $event)"
      />
      <LinkInteraction
        v-else-if="interaction.type === 'link'"
        :interaction="interaction"
        @cancel="$emit('abort')"
        @open-link="$emit('open-link', $event)"
      />
      <ProgressInteraction
        v-else-if="interaction.type === 'progress'"
        :interaction="interaction"
        @cancel="$emit('abort')"
        @open-link="$emit('open-link', $event)"
      />
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import ConfirmInteraction from "./interactions/ConfirmInteraction.vue";
import InputInteraction from "./interactions/InputInteraction.vue";
import LinkInteraction from "./interactions/LinkInteraction.vue";
import MultiSelectInteraction from "./interactions/MultiSelectInteraction.vue";
import ProgressInteraction from "./interactions/ProgressInteraction.vue";
import SelectInteraction from "./interactions/SelectInteraction.vue";

export default defineComponent({
  name: "InteractionHost",
  components: {
    ConfirmInteraction,
    InputInteraction,
    LinkInteraction,
    MultiSelectInteraction,
    ProgressInteraction,
    SelectInteraction,
  },
  emits: ["answer", "abort", "open-link"],
  props: {
    interactions: { type: Array as PropType<ChatInteraction[]>, required: true },
  },
  methods: {
    answer(id: string, response: InteractionResponse) {
      this.$emit("answer", { id, response });
    },
    cancel(id: string) {
      this.answer(id, { cancelled: true });
    },
  },
});
</script>

<style scoped>
.interaction-list { display: flex; flex-direction: column; gap: 8px; min-height: 0; max-height: min(420px, 52vh); padding: 4px 12px 10px; overflow: hidden; }
:deep(.interaction-card) { display: flex; flex-direction: column; flex: 0 1 auto; min-height: 0; max-height: 100%; padding: 12px; overflow: hidden; border: 1px solid var(--color-border-strong); border-radius: 10px; background: var(--color-elevated); }
:deep(.interaction-card h3) { margin: 0 0 10px; color: var(--basic-text-heading); font-size: 13px; font-weight: 600; }
:deep(.interaction-card p) { margin: 0 0 10px; color: var(--accent-interaction-content); }
:deep(.interaction-options) { flex: 0 1 auto; min-height: 0; max-height: min(300px, 38vh); overflow-y: auto; scrollbar-gutter: stable; }
:deep(.interaction-choice) { display: grid; width: 100%; padding: 9px 8px !important; text-align: left; }
:deep(.interaction-choice:hover), :deep(.interaction-choice:focus-visible) { background: var(--color-elevated-strong) !important; }
:deep(.interaction-choice small), :deep(.interaction-option small) { margin-top: 2px; color: var(--color-text-secondary); }
:deep(.interaction-option) { display: flex; gap: 9px; align-items: flex-start; padding: 7px 0; cursor: pointer; }
:deep(.interaction-option span) { display: grid; } :deep(.interaction-option strong) { font-size: 13px; font-weight: 500; }
:deep(.interaction-card input[type="text"]), :deep(.interaction-card input[type="password"]), :deep(.interaction-card textarea) { box-sizing: border-box; width: 100%; padding: 9px 10px; border: 1px solid var(--color-border-strong); border-radius: 7px; outline: none; color: var(--color-text); background: var(--color-background); font: inherit; }
:deep(.interaction-actions) { flex: none; display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--color-border); background: var(--color-elevated); }
:deep(.interaction-code) { display: block; width: fit-content; margin: 10px 0; padding: 8px 10px; border-radius: 7px; color: var(--color-text); background: var(--color-background); font-size: 15px; letter-spacing: .08em; }
:deep(.interaction-progress .app-button) { margin-right: 8px; }
</style>
