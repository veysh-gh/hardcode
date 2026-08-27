<template>
  <section class="interaction-card">
    <h3>{{ interaction.title }}</h3>
    <p v-if="interaction.instructions">{{ interaction.instructions }}</p>
    <code v-if="interaction.code" class="interaction-code">{{ interaction.code }}</code>
    <div class="interaction-actions">
      <AppButton @click="$emit('cancel')">Cancel</AppButton>
      <AppButton variant="primary" @click="$emit('open-link', interaction.url)">Open browser</AppButton>
    </div>
  </section>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import AppButton from "../../ui/AppButton.vue";

export default defineComponent({
  name: "LinkInteraction",
  components: { AppButton },
  emits: ["cancel", "open-link"],
  props: {
    interaction: { type: Object as PropType<ChatInteraction>, required: true },
  },
});
</script>
