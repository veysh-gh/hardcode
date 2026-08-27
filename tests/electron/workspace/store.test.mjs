import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWorkspaceStore } from "../../../electron/workspace/store.mjs";

async function createTemporaryStore(t) {
  const userDataPath = await mkdtemp(
    path.join(os.tmpdir(), "hardcode-user-data-"),
  );
  t.after(() => rm(userDataPath, { recursive: true, force: true }));

  return {
    store: createWorkspaceStore(userDataPath),
    userDataPath,
  };
}

test("stores workspace data below Electron's userData directory", async (t) => {
  const { store, userDataPath } = await createTemporaryStore(t);
  const workspaceData = {
    workspaces: [{ id: "workspace-1", tasks: [] }],
  };

  assert.equal(store.storePath, path.join(userDataPath, "workspaces.json"));
  assert.equal(store.dataPath, path.join(userDataPath, "workspaces"));

  await store.write(workspaceData);

  assert.deepEqual(await store.read(), workspaceData);
});

test("rejects workspace data that does not match the current format", async (t) => {
  const { store } = await createTemporaryStore(t);
  const invalidWorkspaceData = {
    workspaces: [{ id: "workspace-without-tasks" }],
  };

  await store.write(invalidWorkspaceData);

  await assert.rejects(store.read(), /Invalid workspace store/);
});

test("continues processing queued writes after one write fails", async (t) => {
  const { store } = await createTemporaryStore(t);

  await assert.rejects(
    store.queueWrite(async () => {
      throw new Error("expected write failure");
    }),
    /expected write failure/,
  );

  await store.queueWrite(() => store.write({ workspaces: [] }));

  assert.deepEqual(await store.read(), { workspaces: [] });
});

test("finds and updates a task in its workspace", async (t) => {
  const { store } = await createTemporaryStore(t);
  await store.write({
    workspaces: [
      {
        id: "workspace-1",
        tasks: [{ id: "task-1", name: "Original" }],
      },
    ],
  });

  const original = await store.requireTask("workspace-1", "task-1");
  assert.equal(original.workspace.id, "workspace-1");
  assert.equal(original.task.name, "Original");

  await store.updateTask("workspace-1", "task-1", (task) => {
    task.name = "Updated";
  });

  const updated = await store.requireTask("workspace-1", "task-1");
  assert.equal(updated.task.name, "Updated");
});

test("reports when a required workspace or task is missing", async (t) => {
  const { store } = await createTemporaryStore(t);
  await store.write({
    workspaces: [{ id: "workspace-1", tasks: [] }],
  });

  await assert.rejects(store.requireWorkspace("missing"), /Unknown workspace/);
  await assert.rejects(
    store.requireTask("workspace-1", "missing"),
    /Unknown task/,
  );
});
