<template><div ref="element" class="mini-diff" /></template>

<script lang="ts">
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import { defineComponent, type PropType } from "vue";
import { diffExtension, diffTheme, languageForPath, type DiffPreview } from "./code-diff";

interface Resources { editor: EditorView; language: Compartment; diff: Compartment; }
const viewers = new WeakMap<object, Resources>();

export default defineComponent({
  name: "MiniDiffViewer",
  props: { preview: { type: Object as PropType<DiffPreview>, required: true } },
  mounted() {
    const language = new Compartment();
    const diff = new Compartment();
    const editor = new EditorView({
      doc: this.preview.content,
      extensions: [
        basicSetup,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        document.documentElement.dataset.theme === "light" ? githubLight : githubDark,
        language.of(languageForPath(this.preview.path)),
        diff.of(diffExtension(this.preview.original, false)),
        diffTheme,
        EditorView.theme({ "&": { height: "auto" }, ".cm-scroller": { overflow: "visible" }, ".cm-content": { padding: "0" }, ".cm-gutters": { display: "none" } }),
      ],
      parent: this.$refs.element as HTMLElement,
    });
    viewers.set(this, { editor, language, diff });
  },
  beforeUnmount() { viewers.get(this)?.editor.destroy(); viewers.delete(this); },
  watch: {
    preview() {
      const resources = viewers.get(this);
      if (!resources) return;
      resources.editor.dispatch({
        changes: { from: 0, to: resources.editor.state.doc.length, insert: this.preview.content },
        effects: [
          resources.language.reconfigure(languageForPath(this.preview.path)),
          resources.diff.reconfigure(diffExtension(this.preview.original, false)),
        ],
      });
    },
  },
});
</script>

<style scoped>
.mini-diff { margin: 0 10px; overflow: hidden; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-background); }
</style>
