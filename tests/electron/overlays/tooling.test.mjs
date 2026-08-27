import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveOverlayFilePath } from "../../../electron/overlay-tooling.mjs";

test("resolves a nested overlay file back to its source file", () => {
  const projectPath = path.resolve("C:/project");
  const overlayRootPath = path.join(projectPath, "data", "task-overlay");
  const overlayFilePath = path.join(overlayRootPath, "src", "TaskTabs.vue");
  const overlayRoot = {
    sourcePath: projectPath,
    overlayPath: overlayRootPath,
    basePath: path.join(projectPath, "data", "task-bases"),
  };

  const resolvedFile = resolveOverlayFilePath(
    overlayRootPath,
    [overlayRoot],
    overlayFilePath,
    "Edit",
  );

  const expectedSourcePath = path.join(projectPath, "src", "TaskTabs.vue");
  assert.equal(resolvedFile.relativePath, path.join("src", "TaskTabs.vue"));
  assert.equal(resolvedFile.overlayPath, overlayFilePath);
  assert.equal(resolvedFile.projectPath, expectedSourcePath);
  assert.equal(resolvedFile.sourcePath, expectedSourcePath);
});
