<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div v-if="open" class="dialog-backdrop" @mousedown.self="$emit('cancel')">
        <section
          ref="dialog"
          class="app-dialog"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
        >
          <header class="app-dialog-header">
            <h2 :id="titleId">{{ title }}</h2>
            <AppButton
              class="app-dialog-close"
              size="icon"
              variant="subtle"
              type="button"
              aria-label="Close dialog"
              @click="$emit('cancel')"
            >
              ×
            </AppButton>
          </header>

          <div class="app-dialog-content">
            <slot />
          </div>

          <footer class="app-dialog-actions">
            <slot name="actions">
              <AppButton ref="cancelButton" type="button" @click="$emit('cancel')">
                {{ cancelLabel }}
              </AppButton>
              <AppButton
                type="button"
                :variant="danger ? 'danger' : 'primary'"
                @click="$emit('confirm')"
              >
                {{ confirmLabel }}
              </AppButton>
            </slot>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script lang="ts">
import AppButton from "./AppButton.vue";
import { defineComponent, nextTick } from "vue";

export default defineComponent({
  name: "AppDialog",
  components: { AppButton },
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, required: true },
    confirmLabel: { type: String, default: "Confirm" },
    cancelLabel: { type: String, default: "Cancel" },
    danger: { type: Boolean, default: false },
  },
  emits: ["confirm", "cancel"],
  data() {
    return {
      titleId: `dialog-title-${crypto.randomUUID()}`,
      previousFocus: null as HTMLElement | null,
    };
  },
  watch: {
    open(isOpen: boolean) {
      if (isOpen) this.focusDialog();
      else this.restoreFocus();
    },
  },
  mounted() {
    document.addEventListener("keydown", this.handleKeydown);
    if (this.open) this.focusDialog();
  },
  beforeUnmount() {
    document.removeEventListener("keydown", this.handleKeydown);
    this.restoreFocus();
  },
  methods: {
    async focusDialog() {
      this.previousFocus = document.activeElement as HTMLElement | null;
      await nextTick();
      (this.$refs.cancelButton as { focus: () => void } | undefined)?.focus();
    },
    restoreFocus() {
      this.previousFocus?.focus();
      this.previousFocus = null;
    },
    handleKeydown(event: KeyboardEvent) {
      if (!this.open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        this.$emit("cancel");
      }
    },
  },
});
</script>

<style scoped>
.dialog-backdrop {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--overlay-backdrop);
  backdrop-filter: blur(3px);
}

.app-dialog {
  width: min(440px, 100%);
  overflow: hidden;
  border: 1px solid var(--color-border-strong);
  border-radius: 12px;
  color: var(--color-text);
  background: var(--color-elevated);
  box-shadow: 0 24px 70px var(--overlay-shadow-dialog);
  font: 13px/1.5 system-ui, sans-serif;
}

.app-dialog-header {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--color-border);
}

.app-dialog-header h2 {
  flex: 1;
  margin: 0;
  color: var(--basic-text-heading);
  font-size: 15px;
  font-weight: 600;
}

.app-dialog-close.app-button {
  font-size: 20px;
}

.app-dialog-content {
  padding: 18px;
  color: var(--basic-text-content);
}

.app-dialog-content > :first-child {
  margin-top: 0;
}

.app-dialog-content > :last-child {
  margin-bottom: 0;
}

.app-dialog-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 0 18px 18px;
}

.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 120ms ease;
}

.dialog-fade-enter-active .app-dialog,
.dialog-fade-leave-active .app-dialog {
  transition: transform 120ms ease, opacity 120ms ease;
}

.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}

.dialog-fade-enter-from .app-dialog,
.dialog-fade-leave-to .app-dialog {
  opacity: 0;
  transform: translateY(5px) scale(0.985);
}
</style>
