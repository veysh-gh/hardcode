import { defineTool } from "@earendil-works/pi-coding-agent";
import { createDocumentStore } from "./documents/store.mjs";

export function createDocumentTooling({ workspaceRoot, taskId }) {
  const documents = createDocumentStore({ workspaceRoot, taskId });
  const customTools = [
    defineTool({
      name: "document_list",
      label: "List documents",
      description: "List workspace or task notes and memory documents.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["workspace-notes", "workspace-memory", "task-notes", "task-memory"] },
          path: { type: "string", description: "Optional relative directory inside the scope" },
        },
        required: ["scope"],
      },
      async execute(_toolCallId, params) {
        const files = await documents.list(params.scope, params.path);
        return { content: [{ type: "text", text: files.join("\n") || "No documents found." }], details: { files } };
      },
    }),
    defineTool({
      name: "document_read",
      label: "Read document",
      description: "Read a document from workspace or task notes and memory.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["workspace-notes", "workspace-memory", "task-notes", "task-memory"] },
          path: { type: "string", description: "Relative document path" },
        },
        required: ["scope", "path"],
      },
      async execute(_toolCallId, params) {
        const content = await documents.read(params.scope, params.path);
        return { content: [{ type: "text", text: content }], details: { scope: params.scope, path: params.path } };
      },
    }),
    defineTool({
      name: "document_write",
      label: "Write document",
      description: "Create or replace a workspace or task note/memory document. Paths are scoped and cannot escape the document store.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["workspace-notes", "workspace-memory", "task-notes", "task-memory"] },
          path: { type: "string", description: "Relative document path" },
          content: { type: "string" },
        },
        required: ["scope", "path", "content"],
      },
      async execute(_toolCallId, params) {
        await documents.write(params.scope, params.path, params.content);
        return { content: [{ type: "text", text: `Wrote ${params.scope}/${params.path}` }], details: { scope: params.scope, path: params.path } };
      },
    }),
    defineTool({
      name: "document_search",
      label: "Search documents",
      description: "Search text across workspace and task notes and memory documents.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          scope: { type: "string", enum: ["workspace-notes", "workspace-memory", "task-notes", "task-memory"] },
        },
        required: ["query"],
      },
      async execute(_toolCallId, params) {
        const matches = await documents.search(params.query, params.scope);
        return { content: [{ type: "text", text: matches.join("\n") || "No matching documents found." }], details: { matches } };
      },
    }),
  ];
  return { customTools };
}
