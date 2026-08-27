<template>
  <section class="interaction-card">
    <h3>{{ interaction.title }}</h3>
    <div class="interaction-options">
      <AppButton
        v-for="option in interaction.options"
        :key="option.id"
        class="interaction-choice"
        variant="subtle"
        type="button"
        @click="$emit('answer', { value: option.id })"
      >
        <span>{{ option.label }}</span>
        <small v-if="option.description">{{ option.description }}</small>
      </AppButton>
    </div>
    <div class="interaction-actions">
      <AppButton @click="$emit('cancel')">Cancel</AppButton>
    </div>
  </section>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import AppButton from "../../ui/AppButton.vue";

export default defineComponent({
  name: "SelectInteraction",
  components: { AppButton },
  emits: ["answer", "cancel"],
  props: {
    interaction: { type: Object as PropType<ChatInteraction>, required: true },
  },
});
</script>
