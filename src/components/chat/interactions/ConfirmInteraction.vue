<template>
  <section class="interaction-card">
    <h3>{{ interaction.title }}</h3>
    <p v-if="interaction.message">{{ interaction.message }}</p>
    <div class="interaction-actions">
      <AppButton @click="$emit('answer', { confirmed: false })">No</AppButton>
      <AppButton variant="primary" @click="$emit('answer', { confirmed: true })">Yes</AppButton>
    </div>
  </section>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import AppButton from "../../ui/AppButton.vue";

export default defineComponent({
  name: "ConfirmInteraction",
  components: { AppButton },
  emits: ["answer"],
  props: {
    interaction: { type: Object as PropType<ChatInteraction>, required: true },
  },
});
</script>
