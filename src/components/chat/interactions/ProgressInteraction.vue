<template>
  <section class="interaction-card interaction-progress">
    <h3>{{ interaction.title }}</h3>
    <p>{{ interaction.message }}</p>
    <AppButton
      v-for="link in interaction.links"
      :key="link.url"
      type="button"
      @click="$emit('open-link', link.url)"
    >
      {{ link.label || "Open link" }}
    </AppButton>
    <AppButton @click="$emit('cancel')">Cancel</AppButton>
  </section>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import AppButton from "../../ui/AppButton.vue";

export default defineComponent({
  name: "ProgressInteraction",
  components: { AppButton },
  emits: ["cancel", "open-link"],
  props: {
    interaction: { type: Object as PropType<ChatInteraction>, required: true },
  },
});
</script>
