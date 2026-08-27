<template>
  <section class="editor-pane">
    <header class="editor-file-header" :title="file?.path">
      <span>{{ file?.path || "No file selected" }}</span>
      <div class="editor-file-actions">
        <small v-if="file?.mergeConflict" class="change-conflict">
          {{ file.mergeConflict.stale ? "conflict · original updated" : "conflict" }}
        </small>
        <small v-else-if="file?.status" :class="`change-${file.status}`">{{ file.status }}</small>
        <AppButton v-if="file?.status === 'modified' && !file.mergeConflict" size="icon" variant="subtle" type="button" class="editor-file-action" aria-label="Revert file" title="Revert file" @click="$emit('revert')">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M8 7H4v-4M4.5 7.5A8 8 0 1 1 4 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </AppButton>
        <AppButton v-if="file?.status === 'deleted' && !file.mergeConflict" size="icon" variant="subtle" type="button" class="editor-file-action" aria-label="Restore file" title="Restore file" @click="$emit('restore')">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M12 5v10m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </AppButton>
        <AppButton v-if="diffMode && file?.status && !file.mergeConflict" size="small" type="button" class="editor-context-button" @click="contextExpanded = !contextExpanded">
          {{ contextExpanded ? "Collapse context" : "Expand context" }}
        </AppButton>
        <AppButton
          v-if="file?.mergeConflict"
          size="small"
          type="button"
          :disabled="unresolvedConflicts > 0"
          :title="unresolvedConflicts > 0 ? `Resolve ${unresolvedConflicts} conflict block(s) first.` : 'Save the merge result.'"
          @click="resolveMerge"
        >
          Resolve merge
        </AppButton>
      </div>
    </header>
    <div v-if="!file" class="editor-empty-state">
      <strong>No file selected</strong>
      <span>Select a file from the project tree to view or edit it.</span>
    </div>
    <div v-show="file" ref="editorElement" class="editor-content" :class="{ 'is-merge': Boolean(file?.mergeConflict) }"></div>
  </section>
</template>

<script lang="ts">
import AppButton from "../ui/AppButton.vue";
import { defineComponent, type PropType } from "vue";
import { Compartment, StateEffect, StateField, Transaction, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { diffLines } from "diff";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { vue } from "@codemirror/lang-vue";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import { diffExtension as createDiffExtension, diffTheme, languageForPath as getLanguageForPath } from "./code-diff";

interface EditorResources {
  editor: EditorView;
  language: Compartment;
  diff: Compartment;
  merge: Compartment;
  editable: Compartment;
  resizeObserver: ResizeObserver;
  measureMergeActions: () => void;
}

const editors = new WeakMap<object, EditorResources>();
const mergeBlockPattern = /^<<<<<<< task\r?\n([\s\S]*?)^\|\|\|\|\|\|\| base\r?\n([\s\S]*?)^=======\r?\n([\s\S]*?)^>>>>>>> original(?:\r?\n|$)/gm;
const resolveMergeBlock = StateEffect.define<string>();

interface MergeBlock {
  id: string;
  from: number;
  to: number;
  task: string;
  base: string;
  original: string;
}

function mergeDocument(content: string) {
  let document = "";
  let cursor = 0;
  const blocks: MergeBlock[] = [];
  for (const [index, match] of [...content.matchAll(new RegExp(mergeBlockPattern.source, mergeBlockPattern.flags))].entries()) {
    document += content.slice(cursor, match.index);
    const from = document.length;
    document += match[1];
    blocks.push({ id: `merge-${index}`, from, to: document.length, task: match[1], base: match[2], original: match[3] });
    cursor = match.index + match[0].length;
  }
  document += content.slice(cursor);
  return { content: document, blocks };
}

function joinedChanges(task: string, original: string) {
  if (!task) return original;
  if (!original) return task;
  return `${task}${task.endsWith("\n") || original.startsWith("\n") ? "" : "\n"}${original}`;
}

class MergeChoiceWidget extends WidgetType {
  constructor(
    private readonly id: string,
    private readonly task: string,
    private readonly base: string,
    private readonly original: string,
    private readonly resolve: (view: EditorView, id: string, content?: string) => void,
  ) { super(); }

  eq(other: MergeChoiceWidget) {
    return this.id === other.id && this.task === other.task && this.base === other.base && this.original === other.original;
  }

  toDOM(view: EditorView) {
    const element = document.createElement("div");
    element.className = "cm-merge-block-start";
    const toolbar = document.createElement("div");
    toolbar.className = "cm-merge-choice";
    const label = document.createElement("strong");
    label.textContent = "Merge conflict";
    toolbar.append(label);
    const actions = document.createElement("div");
    actions.className = "cm-merge-actions";
    const addButton = (labelText: string, content?: string) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = labelText;
      button.addEventListener("click", () => this.resolve(view, this.id, content));
      actions.append(button);
    };
    addButton("Accept task");
    addButton("Accept original", this.original);
    if (this.task && this.original) addButton("Accept both", `__HARDCODE_BOTH__${this.original}`);
    toolbar.append(actions);
    const taskHeader = document.createElement("div");
    taskHeader.className = "cm-merge-side-header is-task";
    taskHeader.textContent = this.task ? "Task" : "Task · deletion";
    element.append(toolbar, taskHeader);
    if (!this.task && this.base) {
      const deleted = document.createElement("pre");
      deleted.className = "cm-merge-deleted-content";
      deleted.textContent = this.base;
      element.append(deleted);
    }
    return element;
  }

  ignoreEvent() { return false; }
}

class OriginalChangeWidget extends WidgetType {
  constructor(private readonly id: string, private readonly content: string, private readonly base: string) { super(); }
  eq(other: OriginalChangeWidget) { return this.id === other.id && this.content === other.content && this.base === other.base; }
  toDOM() {
    const element = document.createElement("div");
    element.className = "cm-merge-original-block";
    const label = document.createElement("div");
    label.className = "cm-merge-side-header is-original";
    const deleted = !this.content && Boolean(this.base);
    label.textContent = deleted ? "Original · deletion" : "Original";
    const code = document.createElement("pre");
    code.className = deleted ? "cm-merge-deleted-content" : "";
    code.textContent = deleted ? this.base : this.content;
    element.append(label, code);
    return element;
  }
  ignoreEvent() { return true; }
}

function mergeExtension(blocks: MergeBlock[], onResolved: () => void) {
  let field: StateField<ReturnType<typeof Decoration.set>>;
  const rangeFor = (state: EditorState, id: string) => {
    let result = { from: 0, to: 0 };
    state.field(field).between(0, state.doc.length, (from, to, value) => {
      if (value.spec.blockId === id && value.spec.mergeRange && to - from >= result.to - result.from) {
        result = { from, to };
      }
    });
    return result;
  };
  const resolve = (view: EditorView, id: string, choice?: string) => {
    const range = rangeFor(view.state, id);
    const current = view.state.sliceDoc(range.from, range.to);
    const content = choice?.startsWith("__HARDCODE_BOTH__")
      ? joinedChanges(current, choice.slice("__HARDCODE_BOTH__".length))
      : choice;
    view.dispatch({
      ...(content === undefined ? {} : { changes: { from: range.from, to: range.to, insert: content } }),
      effects: resolveMergeBlock.of(id),
      selection: { anchor: range.from },
      scrollIntoView: true,
    });
    onResolved();
  };
  const initialDecorations = () => {
    const decorations = [];
    for (const block of blocks) {
      decorations.push(Decoration.widget({
        widget: new MergeChoiceWidget(block.id, block.task, block.base, block.original, resolve),
        block: true,
        side: -1,
        blockId: block.id,
        mergeRange: block.from === block.to,
      }).range(block.from));
      if (block.from < block.to) {
        decorations.push(Decoration.mark({ class: "cm-merge-task", blockId: block.id, mergeRange: true }).range(block.from, block.to));
      }
      decorations.push(Decoration.widget({
        widget: new OriginalChangeWidget(block.id, block.original, block.base),
        block: true,
        side: 1,
        blockId: block.id,
      }).range(block.to));
    }
    return Decoration.set(decorations, true);
  };
  field = StateField.define({
    create: initialDecorations,
    update(decorations, transaction) {
      let updated = decorations.map(transaction.changes);
      for (const effect of transaction.effects) {
        if (effect.is(resolveMergeBlock)) {
          updated = updated.update({ filter: (_from, _to, value) => value.spec.blockId !== effect.value });
        }
      }
      return updated;
    },
    provide: (value) => EditorView.decorations.from(value),
  });
  return field;
}

function languageForPath(filePath?: string) {
  const extension = filePath?.toLowerCase().match(/\.[^.\\/]+$/)?.[0];

  switch (extension) {
    case ".js":
    case ".mjs":
    case ".cjs":
      return javascript();
    case ".ts":
    case ".mts":
    case ".cts":
      return javascript({ typescript: true });
    case ".jsx":
      return javascript({ jsx: true });
    case ".tsx":
      return javascript({ typescript: true, jsx: true });
    case ".vue":
      return vue();
    case ".html":
    case ".htm":
      return html();
    case ".css":
      return css();
    case ".json":
    case ".jsonc":
      return json();
    case ".md":
    case ".markdown":
      return markdown();
    case ".py":
    case ".pyw":
      return python();
    default:
      return [];
  }
}

class RemovedLineWidget extends WidgetType {
  constructor(private readonly text: string) { super(); }

  eq(other: RemovedLineWidget) { return this.text === other.text; }

  toDOM() {
    const element = document.createElement("div");
    element.className = "cm-diff-removed-line";
    element.textContent = `− ${this.text || " "}`;
    return element;
  }

  ignoreEvent() { return true; }
}

class CollapsedContextWidget extends WidgetType {
  constructor(private readonly lineCount: number) { super(); }

  eq(other: CollapsedContextWidget) { return this.lineCount === other.lineCount; }

  toDOM() {
    const element = document.createElement("div");
    element.className = "cm-diff-collapsed-context";
    element.textContent = `⋯ ${this.lineCount} unchanged lines ⋯`;
    return element;
  }

  ignoreEvent() { return true; }
}

function partLines(value: string) {
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function diffExtension(originalContent: string, expanded: boolean) {
  return EditorView.decorations.compute(["doc"], (state) => {
    const currentContent = state.doc.toString();
    if (currentContent === originalContent) return Decoration.none;

    const decorations = [];
    const changedLines = new Set<number>();
    const removedLines: Array<{ position: number; text: string }> = [];
    let currentLine = 1;
    for (const part of diffLines(originalContent, currentContent)) {
      const lines = partLines(part.value);
      if (part.removed) {
        const position = currentLine <= state.doc.lines ? state.doc.line(currentLine).from : state.doc.length;
        const anchor = Math.min(currentLine, state.doc.lines);
        if (anchor > 0) changedLines.add(anchor);
        for (const line of lines) removedLines.push({ position, text: line });
        continue;
      }

      if (part.added) {
        for (let index = 0; index < lines.length && currentLine + index <= state.doc.lines; index += 1) {
          changedLines.add(currentLine + index);
        }
      }
      currentLine += lines.length;
    }

    for (const { position, text } of removedLines) {
      decorations.push(Decoration.widget({ widget: new RemovedLineWidget(text), side: -1, block: true }).range(position));
    }
    for (const lineNumber of changedLines) {
      decorations.push(Decoration.line({ class: "cm-diff-added" }).range(state.doc.line(lineNumber).from));
    }

    if (!expanded) {
      const contextLines = 3;
      let lineNumber = 1;
      while (lineNumber <= state.doc.lines) {
        if (changedLines.has(lineNumber)) { lineNumber += 1; continue; }
        const start = lineNumber;
        while (lineNumber <= state.doc.lines && !changedLines.has(lineNumber)) lineNumber += 1;
        const end = lineNumber - 1;
        const hiddenStart = start + (start > 1 ? contextLines : 0);
        const hiddenEnd = end - (end < state.doc.lines ? contextLines : 0);
        if (hiddenEnd >= hiddenStart) {
          const from = state.doc.line(hiddenStart).from;
          const to = hiddenEnd < state.doc.lines ? state.doc.line(hiddenEnd + 1).from : state.doc.length;
          decorations.push(Decoration.replace({ widget: new CollapsedContextWidget(hiddenEnd - hiddenStart + 1), block: true }).range(from, to));
        }
      }
    }
    return Decoration.set(decorations, true);
  });
}

export default defineComponent({
  name: "EditorComponent",
  components: { AppButton },
  emits: ["change", "resolve", "revert", "restore"],
  props: {
    file: { type: Object as PropType<WorkspaceFile | null>, default: null },
    diffMode: { type: Boolean, default: false },
  },
  data() {
    return {
      contextExpanded: false,
      unresolvedConflicts: mergeDocument(this.file?.content ?? "").blocks.length,
    };
  },
  watch: {
    file() {
      this.contextExpanded = false;
      this.showFile();
    },
    diffMode() {
      this.contextExpanded = false;
      this.showFile();
    },
    contextExpanded() {
      this.showFile();
    },
  },
  mounted() {
    const initialMerge = mergeDocument(this.file?.content ?? "");
    const language = new Compartment();
    const diff = new Compartment();
    const merge = new Compartment();
    const editable = new Compartment();
    const editor = new EditorView({
      doc: initialMerge.content,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        document.documentElement.dataset.theme === "light" ? githubLight : githubDark,
        language.of(getLanguageForPath(this.file?.path)),
        diff.of(this.diffMode && this.file?.status && !this.file.mergeConflict ? createDiffExtension(this.file.originalContent ?? "", this.contextExpanded) : []),
        merge.of(this.file?.mergeConflict ? mergeExtension(initialMerge.blocks, () => { this.unresolvedConflicts -= 1; }) : []),
        editable.of(EditorView.editable.of(this.file?.status !== "deleted")),
        EditorView.updateListener.of((update) => {
          if (!this.file?.mergeConflict && update.docChanged && update.transactions.some((transaction) => transaction.annotation(Transaction.userEvent))) {
            this.$emit("change", update.state.doc.toString());
          }
        }),
        diffTheme,
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { overflow: "auto" },
          ".cm-gutters": { backgroundColor: "var(--feature-editor-gutter-background)" },
        }),
      ],
      parent: this.$refs.editorElement as HTMLElement,
    });
    const measureMergeActions = () => {
      const scrollerRect = editor.scrollDOM.getBoundingClientRect();
      const contentRect = editor.contentDOM.getBoundingClientRect();
      const contentOrigin = contentRect.left + editor.scrollDOM.scrollLeft;
      for (const actions of editor.dom.querySelectorAll<HTMLElement>(".cm-merge-actions")) {
        const toolbar = actions.parentElement;
        const label = toolbar?.querySelector<HTMLElement>("strong");
        if (!toolbar) continue;
        const actionsWidth = actions.offsetWidth;
        const naturalLeft = scrollerRect.right - contentOrigin - actionsWidth - 12;
        const minimumLeft = (label?.offsetWidth ?? 0) + 18;
        toolbar.style.paddingLeft = `${Math.max(minimumLeft, naturalLeft)}px`;
        actions.style.left = `${Math.max(0, editor.scrollDOM.clientWidth - actionsWidth - 12)}px`;
      }
    };
    const resizeObserver = new ResizeObserver(measureMergeActions);
    resizeObserver.observe(editor.scrollDOM);
    measureMergeActions();

    editors.set(this, { editor, language, diff, merge, editable, resizeObserver, measureMergeActions });
  },
  beforeUnmount() {
    const resources = editors.get(this);
    resources?.resizeObserver.disconnect();
    resources?.editor.destroy();
    editors.delete(this);
  },
  methods: {
    showFile() {
      const resources = editors.get(this);
      if (!resources) return;
      const merge = mergeDocument(this.file?.content ?? "");
      this.unresolvedConflicts = merge.blocks.length;
      resources.editor.dispatch({
        changes: {
          from: 0,
          to: resources.editor.state.doc.length,
          insert: merge.content,
        },
        effects: [
          resources.language.reconfigure(getLanguageForPath(this.file?.path)),
          resources.diff.reconfigure(this.diffMode && this.file?.status && !this.file.mergeConflict ? createDiffExtension(this.file.originalContent ?? "", this.contextExpanded) : []),
          resources.editable.reconfigure(EditorView.editable.of(this.file?.status !== "deleted")),
        ],
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
      // Install merge decorations only after the replacement document exists.
      // Creating a StateField for new-document positions in the same transaction
      // would map those positions through the previous (possibly empty) document.
      resources.editor.dispatch({
        effects: resources.merge.reconfigure(
          this.file?.mergeConflict
            ? mergeExtension(merge.blocks, () => { this.unresolvedConflicts -= 1; })
            : [],
        ),
      });
      resources.measureMergeActions();
    },
    resolveMerge() {
      const resources = editors.get(this);
      if (!resources || !this.file?.mergeConflict || this.unresolvedConflicts > 0) return;
      this.$emit("resolve", resources.editor.state.doc.toString());
    },
  },
});
</script>

<style scoped>
.editor-pane { display: grid; grid-template-rows: auto minmax(0, 1fr); min-width: 0; min-height: 0; overflow: hidden; border: 1px solid var(--basic-border-subtle); border-radius: 15px; background: var(--color-panel); }
.editor-file-header { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 10px 12px; overflow: hidden; border-bottom: 1px solid var(--color-border); color: var(--color-text-secondary); font: 12px/1.3 system-ui, sans-serif; text-overflow: ellipsis; white-space: nowrap; }
.editor-file-header > span { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.editor-file-actions { display: flex; align-items: center; flex: 0 0 auto; gap: 6px; }
.editor-file-header small { flex: 0 0 auto; text-transform: uppercase; }
.editor-context-button.app-button { flex: 0 0 auto; }
.editor-file-action.app-button { display: grid; place-items: center; color: var(--basic-text-content); }
.editor-file-action svg { width: 15px; height: 15px; }
.editor-empty-state { display: grid; place-content: center; gap: 6px; min-width: 0; min-height: 0; padding: 24px; color: var(--color-text-secondary); text-align: center; font: 13px/1.4 system-ui, sans-serif; }
.editor-empty-state strong { color: var(--basic-text-heading); font-size: 14px; }
.editor-content { min-width: 0; min-height: 0; height: 100%; overflow: hidden; }
:deep(.cm-editor) { height: 100%; }
:deep(.cm-merge-block-start) { position: relative; box-sizing: border-box; }
:deep(.cm-merge-choice) { position: relative; box-sizing: border-box; display: flex; align-items: center; min-height: 31px; width: 100%; padding: 5px 9px; border-top: 1px solid var(--color-border); border-bottom: 1px solid var(--color-border); background: var(--color-elevated); color: var(--basic-text-content); font: 11px/1.3 system-ui, sans-serif; }
:deep(.cm-merge-choice strong) { position: absolute; left: 9px; text-transform: uppercase; }
:deep(.cm-merge-actions) { position: sticky; z-index: 3; display: flex; flex: 0 0 auto; gap: 6px; padding-left: 8px; background: var(--color-elevated); }
:deep(.cm-merge-choice button) { padding: 3px 7px; border: 1px solid var(--color-border-strong); border-radius: 5px; background: var(--color-elevated-strong); color: var(--color-text); cursor: pointer; font: inherit; }
:deep(.cm-merge-choice button:hover) { background: var(--color-elevated); }
:deep(.cm-merge-side-header) { box-sizing: border-box; width: 100%; padding: 5px 9px; border-bottom: 1px solid var(--color-border); background: var(--color-elevated-strong); color: var(--basic-text-label); font: 600 11px/1.3 system-ui, sans-serif; text-transform: uppercase; }
:deep(.cm-merge-side-header.is-task) { border-left: 3px solid var(--feature-diff-modified); color: var(--feature-diff-modified); }
:deep(.cm-merge-side-header.is-original) { border-left: 3px solid var(--accent-icon); color: var(--accent-icon); }
:deep(.cm-merge-task) { background: var(--state-action); }
:deep(.cm-merge-original-block) { box-sizing: border-box; width: 100%; border-top: 1px solid var(--color-border); border-bottom: 1px solid var(--color-border); background: var(--color-elevated); color: var(--basic-text-content); }
:deep(.cm-merge-original-block pre), :deep(.cm-merge-deleted-content) { box-sizing: border-box; width: 100%; margin: 0; padding: 6px 10px 9px; overflow-x: auto; color: var(--basic-text-code); font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre; }
:deep(.cm-merge-deleted-content) { border-bottom: 1px solid var(--state-failed-border); background: var(--overlay-diff-removed); color: var(--feature-diff-removed); text-decoration: line-through; }
.editor-file-header .change-added { color: var(--state-success) !important; }
.editor-file-header .change-modified { color: var(--feature-diff-modified) !important; }
.editor-file-header .change-deleted { color: var(--state-attention) !important; }
.editor-file-header .change-conflict { color: var(--state-error) !important; }
</style>
