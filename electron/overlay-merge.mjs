import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const deletionMarkerSuffix = ".hardcode-delete";
const absentMarkerSuffix = ".hardcode-absent";
const conflictMarkerSuffix = ".hardcode-conflict";
const conflictTaskSuffix = ".hardcode-conflict-task";
const conflictOriginalSuffix = ".hardcode-conflict-original";

function absentMarkerPath(basePath) {
  return basePath ? `${basePath}${absentMarkerSuffix}` : undefined;
}

export function conflictMarkerPath(basePath) {
  return basePath ? `${basePath}${conflictMarkerSuffix}` : undefined;
}

function conflictTaskPath(basePath) {
  return basePath ? `${basePath}${conflictTaskSuffix}` : undefined;
}

function conflictOriginalPath(basePath) {
  return basePath ? `${basePath}${conflictOriginalSuffix}` : undefined;
}

function deletionMarkerPath(overlayPath) {
  return `${overlayPath}${deletionMarkerSuffix}`;
}

async function removeIfPresent(filePath) {
  if (filePath && existsSync(filePath)) await rm(filePath, { force: true });
}

async function readState(filePath) {
  return existsSync(filePath) ? { exists: true, content: await readFile(filePath) } : { exists: false };
}

async function readBaseState(basePath) {
  if (existsSync(basePath)) return { exists: true, content: await readFile(basePath) };
  if (existsSync(absentMarkerPath(basePath))) return { exists: false };
  return undefined;
}

async function readTaskState(target) {
  if (existsSync(deletionMarkerPath(target.overlayPath))) return { exists: false };
  return readState(target.overlayPath);
}

function statesEqual(left, right) {
  return left.exists === right.exists && (!left.exists || left.content.equals(right.content));
}

async function replaceBaseSnapshot(target, state) {
  await mkdir(path.dirname(target.basePath), { recursive: true });
  await Promise.all([
    removeIfPresent(target.basePath),
    removeIfPresent(absentMarkerPath(target.basePath)),
  ]);
  if (state.exists) await writeFile(target.basePath, state.content);
  else await writeFile(absentMarkerPath(target.basePath), "", "utf8");
}

async function readConflictMetadata(target) {
  const markerPath = conflictMarkerPath(target.basePath);
  if (!markerPath || !existsSync(markerPath)) return undefined;
  try {
    const metadata = JSON.parse(await readFile(markerPath, "utf8"));
    if (
      typeof metadata?.revision !== "string" ||
      typeof metadata?.detectedAt !== "string" ||
      typeof metadata?.baseExists !== "boolean" ||
      typeof metadata?.taskExists !== "boolean" ||
      typeof metadata?.originalExists !== "boolean"
    ) {
      throw new Error("Invalid conflict metadata.");
    }
    return metadata;
  } catch (error) {
    throw new Error(`Could not read conflict metadata: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeConflictSnapshot(filePath, state) {
  await removeIfPresent(filePath);
  if (state.exists) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, state.content);
  }
}

async function writeConflict(target, { base, task, original, stale = false, detectedAt } = {}) {
  const now = new Date().toISOString();
  const metadata = {
    path: target.relativePath,
    revision: randomUUID(),
    detectedAt: detectedAt ?? now,
    updatedAt: now,
    stale,
    baseExists: base.exists,
    taskExists: task.exists,
    originalExists: original.exists,
  };
  await Promise.all([
    writeConflictSnapshot(conflictTaskPath(target.basePath), task),
    writeConflictSnapshot(conflictOriginalPath(target.basePath), original),
  ]);
  await writeFile(conflictMarkerPath(target.basePath), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return metadata;
}

export async function ensureBaseSnapshot(target) {
  if (!target.basePath || !target.sourcePath) return;
  if (await readBaseState(target.basePath)) return;
  await replaceBaseSnapshot(target, await readState(target.sourcePath));
}

export async function clearOverlayState(target) {
  await Promise.all([
    removeIfPresent(target.overlayPath),
    removeIfPresent(deletionMarkerPath(target.overlayPath)),
    removeIfPresent(target.basePath),
    removeIfPresent(absentMarkerPath(target.basePath)),
    removeIfPresent(conflictMarkerPath(target.basePath)),
    removeIfPresent(conflictTaskPath(target.basePath)),
    removeIfPresent(conflictOriginalPath(target.basePath)),
  ]);
}

export async function clearConflict(target) {
  if (!target.basePath) return;
  if (existsSync(conflictMarkerPath(target.basePath)) && target.sourcePath) {
    await replaceBaseSnapshot(target, await readState(target.sourcePath));
  }
  await Promise.all([
    removeIfPresent(conflictMarkerPath(target.basePath)),
    removeIfPresent(conflictTaskPath(target.basePath)),
    removeIfPresent(conflictOriginalPath(target.basePath)),
  ]);
}

async function writeTaskState(target, state) {
  await mkdir(path.dirname(target.overlayPath), { recursive: true });
  await Promise.all([
    removeIfPresent(target.overlayPath),
    removeIfPresent(deletionMarkerPath(target.overlayPath)),
  ]);
  if (state.exists) await writeFile(target.overlayPath, state.content);
  else await writeFile(deletionMarkerPath(target.overlayPath), "", "utf8");
}

function isText(state) {
  return !state.exists || !state.content.subarray(0, 8192).includes(0);
}

function conflictContent(base, task, original) {
  if (![base, task, original].every(isText)) return undefined;
  const section = (state) => state.exists ? state.content.toString("utf8").replace(/\n?$/, "\n") : "";
  return Buffer.from(
    `<<<<<<< task\n${section(task)}||||||| base\n${section(base)}=======\n${section(original)}>>>>>>> original\n`,
    "utf8",
  );
}

function gitMerge(current, base, other) {
  let temporaryDirectory;
  return new Promise((resolve, reject) => {
    void (async () => {
      temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "hardcode-merge-"));
      const currentPath = path.join(temporaryDirectory, "task");
      const basePath = path.join(temporaryDirectory, "base");
      const otherPath = path.join(temporaryDirectory, "original");
      await Promise.all([
        writeFile(currentPath, current),
        writeFile(basePath, base),
        writeFile(otherPath, other),
      ]);
      const child = spawn("git", [
        "merge-file", "--stdout", "--diff3",
        "-L", "task", "-L", "base", "-L", "original",
        currentPath, basePath, otherPath,
      ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      const stdout = [];
      const stderr = [];
      child.stdout.on("data", (data) => stdout.push(Buffer.from(data)));
      child.stderr.on("data", (data) => stderr.push(Buffer.from(data)));
      child.once("error", (error) => reject(new Error(`Git merge is unavailable: ${error.message}`)));
      child.once("close", (exitCode) => {
        const output = Buffer.concat(stdout);
        if (exitCode !== null && exitCode >= 0 && exitCode < 128) {
          resolve({ clean: exitCode === 0, state: { exists: true, content: output } });
        } else {
          reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `git merge-file exited with ${exitCode}.`));
        }
      });
    })().catch(reject);
  }).finally(() => temporaryDirectory
    ? rm(temporaryDirectory, { recursive: true, force: true })
    : undefined);
}

export async function mergeFileStates(base, task, original) {
  if (statesEqual(task, base)) return { clean: true, state: original };
  if (statesEqual(original, base) || statesEqual(task, original)) return { clean: true, state: task };
  if (base.exists && task.exists && original.exists && [base, task, original].every(isText)) {
    return gitMerge(task.content, base.content, original.content);
  }
  return {
    clean: false,
    state: { exists: true, content: conflictContent(base, task, original) ?? task.content ?? original.content ?? Buffer.from("") },
  };
}

export async function synchronizeOverlayTarget(target) {
  if (!target.basePath || !target.sourcePath) return { conflict: false };
  const hasTaskState = existsSync(target.overlayPath) || existsSync(deletionMarkerPath(target.overlayPath));
  if (!hasTaskState) return { conflict: false };
  await ensureBaseSnapshot(target);
  if (existsSync(conflictMarkerPath(target.basePath))) {
    let metadata = await readConflictMetadata(target);
    const original = await readState(target.sourcePath);
    const recordedOriginal = metadata.originalExists
      ? await readState(conflictOriginalPath(target.basePath))
      : { exists: false };
    if (!statesEqual(original, recordedOriginal)) {
      metadata = await writeConflict(target, {
        base: await readBaseState(target.basePath),
        task: metadata.taskExists ? await readState(conflictTaskPath(target.basePath)) : { exists: false },
        original,
        stale: true,
        detectedAt: metadata.detectedAt,
      });
    }
    return { conflict: true, stale: Boolean(metadata.stale) };
  }

  const [base, task, original] = await Promise.all([
    readBaseState(target.basePath),
    readTaskState(target),
    readState(target.sourcePath),
  ]);
  if (statesEqual(base, original)) return { conflict: false };

  const merged = await mergeFileStates(base, task, original);
  if (statesEqual(merged.state, original)) {
    await clearOverlayState(target);
    return { conflict: false };
  }

  if (!merged.clean) {
    await writeTaskState(target, task.exists ? task : { exists: true, content: Buffer.from("") });
    await writeConflict(target, { base, task, original });
    return { conflict: true, stale: false };
  }
  await writeTaskState(target, merged.state);
  await replaceBaseSnapshot(target, original);
  return { conflict: false };
}

export async function readOverlayConflict(target) {
  const synchronized = await synchronizeOverlayTarget(target);
  if (!synchronized.conflict) return undefined;
  const metadata = await readConflictMetadata(target);
  const [base, task, original, result] = await Promise.all([
    readBaseState(target.basePath),
    metadata.taskExists ? readState(conflictTaskPath(target.basePath)) : Promise.resolve({ exists: false }),
    metadata.originalExists ? readState(conflictOriginalPath(target.basePath)) : Promise.resolve({ exists: false }),
    readTaskState(target),
  ]);
  const text = (state) => state.exists ? state.content.toString("utf8") : "";
  const merge = await mergeFileStates(base, task, original);
  return {
    revision: metadata.revision,
    stale: Boolean(metadata.stale),
    baseContent: text(base),
    taskContent: text(task),
    originalContent: text(original),
    resultContent: text(result),
    mergeContent: text(merge.state),
  };
}

export async function resolveOverlayConflict(target, content, revision) {
  const conflict = await readOverlayConflict(target);
  if (!conflict) throw new Error("This file no longer has a merge conflict.");
  if (revision !== conflict.revision) {
    throw new Error("The original changed again. Review the updated merge before resolving it.");
  }
  const original = await readState(target.sourcePath);
  const output = { exists: true, content: Buffer.from(content, "utf8") };
  await clearConflict(target);
  if (statesEqual(output, original)) await clearOverlayState(target);
  else await writeTaskState(target, output);
}

export async function inspectOverlayTarget(target) {
  const synchronized = await synchronizeOverlayTarget(target);
  const task = await readTaskState(target);
  if (!task.exists && !existsSync(deletionMarkerPath(target.overlayPath))) return undefined;
  await ensureBaseSnapshot(target);
  const base = await readBaseState(target.basePath);
  if (statesEqual(base, task)) {
    await clearOverlayState(target);
    return undefined;
  }
  return {
    type: task.exists ? (base.exists ? "modified" : "added") : "deleted",
    conflict: synchronized.conflict || existsSync(conflictMarkerPath(target.basePath)),
  };
}
