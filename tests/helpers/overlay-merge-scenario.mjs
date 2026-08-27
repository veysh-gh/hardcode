import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  conflictMarkerPath,
  deletionMarkerSuffix,
  ensureBaseSnapshot,
  inspectOverlayTarget,
  readOverlayConflict,
  resolveOverlayConflict,
  synchronizeOverlayTarget,
} from "../../electron/overlay-merge.mjs";

export async function createMergeScenario(t, originalContent) {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "hardcode-overlay-test-"),
  );
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const target = {
    sourcePath: path.join(temporaryDirectory, "original", "file.txt"),
    overlayPath: path.join(temporaryDirectory, "overlay", "file.txt"),
    basePath: path.join(temporaryDirectory, "base", "file.txt"),
    relativePath: "file.txt",
  };

  await Promise.all([
    mkdir(path.dirname(target.sourcePath), { recursive: true }),
    mkdir(path.dirname(target.overlayPath), { recursive: true }),
  ]);

  if (originalContent !== undefined) {
    await writeFile(target.sourcePath, originalContent, "utf8");
  }
  await ensureBaseSnapshot(target);

  return {
    conflictMarkerExists() {
      return existsSync(conflictMarkerPath(target.basePath));
    },
    inspect() {
      return inspectOverlayTarget(target);
    },
    markTaskFileDeleted() {
      return writeFile(`${target.overlayPath}${deletionMarkerSuffix}`, "", "utf8");
    },
    readBase() {
      return readFile(target.basePath, "utf8");
    },
    readConflict() {
      return readOverlayConflict(target);
    },
    readTaskFile() {
      return readFile(target.overlayPath, "utf8");
    },
    resolveConflict(content, revision) {
      return resolveOverlayConflict(target, content, revision);
    },
    synchronize() {
      return synchronizeOverlayTarget(target);
    },
    taskDeletionMarkerExists() {
      return existsSync(`${target.overlayPath}${deletionMarkerSuffix}`);
    },
    taskFileExists() {
      return existsSync(target.overlayPath);
    },
    updateOriginal(content) {
      return writeFile(target.sourcePath, content, "utf8");
    },
    updateTask(content) {
      return writeFile(target.overlayPath, content, "utf8");
    },
  };
}
