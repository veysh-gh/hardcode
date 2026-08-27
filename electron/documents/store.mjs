import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveRelativePath } from "../shared/paths.mjs";

const scopeDirectories = Object.freeze({
  "workspace-notes": (workspaceRoot) => path.join(workspaceRoot, "documents", "notes"),
  "workspace-memory": (workspaceRoot) => path.join(workspaceRoot, "documents", "memory"),
  "task-notes": (workspaceRoot, taskId) => path.join(workspaceRoot, "tasks", taskId, "documents", "notes"),
  "task-memory": (workspaceRoot, taskId) => path.join(workspaceRoot, "tasks", taskId, "documents", "memory"),
});

function requireScopeDirectory(workspaceRoot, taskId, scope) {
  const resolveScope = scopeDirectories[scope];
  if (!resolveScope) throw new Error(`Unknown document scope: ${scope}`);
  if (scope.startsWith("task-") && !taskId) {
    throw new Error(`Document scope ${scope} requires a task.`);
  }
  return resolveScope(workspaceRoot, taskId);
}

async function collectFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path.join(directory, entry.name), relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

export function createDocumentStore({ workspaceRoot, taskId }) {
  function resolvePath(scope, requestedPath = "") {
    const scopeDirectory = requireScopeDirectory(workspaceRoot, taskId, scope);
    return resolveRelativePath(scopeDirectory, requestedPath, "Document path escapes its scope.");
  }

  async function list(scope, directoryPath = "") {
    const directory = resolvePath(scope, directoryPath);
    await mkdir(directory, { recursive: true });
    return collectFiles(directory);
  }

  async function read(scope, documentPath) {
    return readFile(resolvePath(scope, documentPath), "utf8");
  }

  async function write(scope, documentPath, content) {
    const destination = resolvePath(scope, documentPath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, "utf8");
  }

  async function search(query, selectedScope) {
    const normalizedQuery = query.toLocaleLowerCase();
    const scopes = selectedScope
      ? [selectedScope]
      : Object.keys(scopeDirectories).filter((scope) => taskId || !scope.startsWith("task-"));
    const matches = [];

    for (const scope of scopes) {
      const directory = resolvePath(scope);
      await mkdir(directory, { recursive: true });
      for (const relativePath of await collectFiles(directory)) {
        const content = await readFile(path.join(directory, relativePath), "utf8");
        if (content.toLocaleLowerCase().includes(normalizedQuery)) {
          matches.push(`${scope}/${relativePath}`);
        }
      }
    }
    return matches;
  }

  return { list, read, write, search };
}
