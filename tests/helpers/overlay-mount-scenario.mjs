import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createOverlayMountManager } from "../../electron/overlay-mount.mjs";

export const WORKSPACE_ID = "workspace";
export const TASK_ID = "task";

export async function createMountScenario(t) {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "hardcode-mount-test-"),
  );
  const projectRoot = path.join(temporaryDirectory, "project");
  const overlayRoot = path.join(temporaryDirectory, "overlay");
  const mountStoragePath = path.join(temporaryDirectory, "mount");
  await Promise.all([
    mkdir(projectRoot, { recursive: true }),
    mkdir(overlayRoot, { recursive: true }),
  ]);

  let currentOperations = [];
  const managers = [];

  function createManager() {
    const manager = createOverlayMountManager({
      storagePath: mountStoragePath,
      getOperations: async () => ({
        operations: currentOperations,
        unmappedPaths: [],
      }),
    });
    managers.push(manager);
    return manager;
  }

  const manager = createManager();

  t.after(async () => {
    for (const activeManager of managers) {
      const mountedTask = activeManager.current();
      if (mountedTask) {
        await activeManager
          .unmount(mountedTask.workspaceId, mountedTask.taskId)
          .catch(() => {});
      }
      activeManager.dispose();
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  function projectPath(relativePath) {
    return path.join(projectRoot, relativePath);
  }

  function taskPath(relativePath) {
    return path.join(overlayRoot, relativePath);
  }

  function change(relativePath, type = "modified") {
    return {
      rootIndex: 0,
      relativePath,
      type,
      overlayPath: taskPath(relativePath),
    };
  }

  async function mount(operations) {
    currentOperations = operations;
    await manager.mount({
      workspaceId: WORKSPACE_ID,
      taskId: TASK_ID,
      taskName: "Task",
      roots: [projectRoot],
      overlayRoots: [overlayRoot],
      operations,
    });
  }

  return {
    change,
    currentMount() {
      return manager.current();
    },
    async finalize() {
      await manager.finalize(WORKSPACE_ID, TASK_ID);
    },
    mount,
    mountAnotherTask(operations) {
      return manager.mount({
        workspaceId: WORKSPACE_ID,
        taskId: "other-task",
        taskName: "Other task",
        roots: [projectRoot],
        overlayRoots: [overlayRoot],
        operations,
      });
    },
    projectFileExists(relativePath) {
      return existsSync(projectPath(relativePath));
    },
    readProjectFile(relativePath) {
      return readFile(projectPath(relativePath), "utf8");
    },
    readProjectSnapshot(relativePath) {
      return readFile(manager.logicalPath(projectPath(relativePath)), "utf8");
    },
    removeTaskFile(relativePath) {
      return rm(taskPath(relativePath), { force: true });
    },
    restartManager() {
      manager.dispose();
      return createManager();
    },
    setOperations(operations) {
      currentOperations = operations;
    },
    snapshotContains(relativePath) {
      return manager.logicalExists(projectPath(relativePath));
    },
    sync() {
      return manager.sync();
    },
    async unmount() {
      await manager.unmount(WORKSPACE_ID, TASK_ID);
    },
    async writeProjectFile(relativePath, content) {
      const filePath = projectPath(relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf8");
    },
    async writeTaskFile(relativePath, content) {
      const filePath = taskPath(relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf8");
    },
  };
}
