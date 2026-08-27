<template>
  <form class="interaction-card" @submit.prevent="submit">
    <h3>{{ interaction.title }}</h3>
    <textarea
      v-if="interaction.multiline"
      v-model="value"
      rows="5"
      :placeholder="interaction.placeholder"
      autofocus
    ></textarea>
    <input
      v-else
      v-model="value"
      :type="interaction.secret ? 'password' : 'text'"
      :placeholder="interaction.placeholder"
      autofocus
    />
    <div class="interaction-actions">
      <AppButton @click="$emit('cancel')">Cancel</AppButton>
      <AppButton type="submit" variant="primary">Continue</AppButton>
    </div>
  </form>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import AppButton from "../../ui/AppButton.vue";

export default defineComponent({
  name: "InputInteraction",
  components: { AppButton },
  emits: ["answer", "cancel"],
  props: {
    interaction: { type: Object as PropType<ChatInteraction>, required: true },
  },
  data() {
    return { value: this.interaction.value ?? "" };
  },
  methods: {
    submit() {
      this.$emit("answer", { value: this.value });
    },
  },
});
</script>
