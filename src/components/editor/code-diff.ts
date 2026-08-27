import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { vue } from "@codemirror/lang-vue";
import { diffLines } from "diff";

export interface DiffPreview {
  path: string;
  original: string;
  content: string;
}

export function languageForPath(filePath?: string) {
  const extension = filePath?.toLowerCase().match(/\.[^.\\/]+$/)?.[0];
  switch (extension) {
    case ".js": case ".mjs": case ".cjs": return javascript();
    case ".ts": case ".mts": case ".cts": return javascript({ typescript: true });
    case ".jsx": return javascript({ jsx: true });
    case ".tsx": return javascript({ typescript: true, jsx: true });
    case ".vue": return vue();
    case ".html": case ".htm": return html();
    case ".css": return css();
    case ".json": case ".jsonc": return json();
    case ".md": case ".markdown": return markdown();
    case ".py": case ".pyw": return python();
    default: return [];
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

export function diffExtension(originalContent: string, expanded: boolean) {
  return EditorView.decorations.compute(["doc"], (state: EditorState) => {
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
      if (part.added) for (let index = 0; index < lines.length && currentLine + index <= state.doc.lines; index += 1) changedLines.add(currentLine + index);
      currentLine += lines.length;
    }
    for (const { position, text } of removedLines) decorations.push(Decoration.widget({ widget: new RemovedLineWidget(text), side: -1, block: true }).range(position));
    for (const lineNumber of changedLines) decorations.push(Decoration.line({ class: "cm-diff-added" }).range(state.doc.line(lineNumber).from));
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

export const diffTheme = EditorView.theme({
  ".cm-diff-added": { backgroundColor: "rgba(46, 160, 67, 0.24)" },
  "&.cm-focused .cm-activeLine.cm-diff-added": { backgroundColor: "rgba(46, 160, 67, 0.45)" },
  ".cm-diff-removed-line": { boxSizing: "border-box", minHeight: "1.4em", padding: "0 4px", color: "var(--feature-diff-removed)", backgroundColor: "var(--overlay-diff-removed)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  ".cm-diff-collapsed-context": { boxSizing: "border-box", padding: "2px 8px", color: "var(--color-text-secondary)", backgroundColor: "var(--color-elevated)", fontStyle: "italic" },
});
