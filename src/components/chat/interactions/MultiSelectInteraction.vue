<template>
  <form class="interaction-card" @submit.prevent="$emit('answer', { values: selected })">
    <h3>{{ interaction.title }}</h3>
    <div class="interaction-options">
      <label v-for="option in interaction.options" :key="option.id" class="interaction-option">
        <input v-model="selected" type="checkbox" :value="option.id" />
        <span>
          <strong>{{ option.label }}</strong>
          <small v-if="option.description">{{ option.description }}</small>
        </span>
      </label>
    </div>
    <div class="interaction-actions">
      <AppButton @click="$emit('cancel')">Cancel</AppButton>
      <AppButton type="submit" variant="primary">Apply</AppButton>
    </div>
  </form>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import AppButton from "../../ui/AppButton.vue";

export default defineComponent({
  name: "MultiSelectInteraction",
  components: { AppButton },
  emits: ["answer", "cancel"],
  props: {
    interaction: { type: Object as PropType<ChatInteraction>, required: true },
  },
  data() {
    return {
      selected: this.interaction.options.filter((option) => option.selected).map((option) => option.id),
    };
  },
});
</script>
