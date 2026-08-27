import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { isPathInside, resolveRelativePath } from "../../../electron/shared/paths.mjs";

test("recognizes the root directory and its descendants as inside", () => {
  const projectRoot = path.resolve("example", "project");
  const sourceFile = path.join(projectRoot, "src", "main.js");

  assert.equal(isPathInside(projectRoot, projectRoot), true);
  assert.equal(isPathInside(projectRoot, sourceFile), true);
});

test("does not mistake a similarly named sibling for a descendant", () => {
  const projectRoot = path.resolve("example", "project");
  const sibling = path.resolve("example", "project-copy");

  assert.equal(isPathInside(projectRoot, sibling), false);
});

test("resolves a safe path below its root", () => {
  const documentsRoot = path.resolve("example", "documents");

  const resolvedPath = resolveRelativePath(documentsRoot, "notes/today.md");

  assert.equal(resolvedPath, path.join(documentsRoot, "notes", "today.md"));
});

test("rejects paths that escape their root", () => {
  const documentsRoot = path.resolve("example", "documents");

  assert.throws(
    () => resolveRelativePath(documentsRoot, "../outside.md"),
    /escapes its root/,
  );
  assert.throws(
    () => resolveRelativePath(documentsRoot, path.resolve("outside.md")),
    /escapes its root/,
  );
});
