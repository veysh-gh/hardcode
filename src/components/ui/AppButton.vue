<template>
  <button
    v-bind="$attrs"
    :disabled="disabled"
    class="app-button"
    :class="[`app-button-${variant}`, `app-button-${size}`, { 'app-button-active': active }]"
    :type="typeof $attrs.type === 'string' ? $attrs.type : 'button'"
  >
    <slot />
  </button>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "AppButton",
  inheritAttrs: false,
  methods: {
    focus() {
      (this.$el as HTMLElement).focus();
    },
  },
  props: {
    variant: {
      type: String,
      default: "default",
      validator: (value: string) => ["default", "primary", "danger", "subtle"].includes(value),
    },
    size: {
      type: String,
      default: "medium",
      validator: (value: string) => ["small", "medium", "large", "icon", "control"].includes(value),
    },
    active: {
      type: Boolean,
      default: false,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
  },
});
</script>

<style scoped>
.app-button {
  box-sizing: border-box;
  border: 1px solid var(--color-border-strong);
  border-radius: 7px;
  color: var(--color-text);
  background: var(--color-elevated-strong);
  cursor: pointer;
  font: 13px/1.2 system-ui, sans-serif;
}

.app-button:hover {
  border-color: var(--basic-border-hover);
  background: var(--color-elevated);
}

.app-button-primary { border-color: var(--state-action-border); color: var(--state-action-text); background: var(--state-action); }
.app-button-danger { border-color: var(--state-danger-border); color: var(--state-danger-text); background: var(--state-danger); }
.app-button-subtle { border-color: transparent; background: transparent; }
.app-button-control { width: 32px; height: 32px; padding: 0; }
.app-button-small { padding: 5px 8px; font-size: 12px; }
.app-button-medium { padding: 7px 11px; }
.app-button-large { padding: 8px 12px; }
.app-button-icon { width: 28px; height: 28px; padding: 0; }
.app-button-active,
.app-button-active:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
  background: var(--color-elevated-strong);
}
.app-button:disabled { opacity: 0.45; cursor: default; }
</style>
