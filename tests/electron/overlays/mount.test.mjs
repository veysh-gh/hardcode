import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  createMountScenario,
  TASK_ID,
  WORKSPACE_ID,
} from "../../helpers/overlay-mount-scenario.mjs";

test("mount projects task changes and unmount restores the project", async (t) => {
  const scenario = await createMountScenario(t);
  await scenario.writeProjectFile("changed.txt", "original");
  await scenario.writeProjectFile("deleted.txt", "bring me back");
  await scenario.writeTaskFile("changed.txt", "task");
  await scenario.writeTaskFile("new/nested/added.txt", "added");

  const changes = [
    scenario.change("changed.txt"),
    scenario.change("deleted.txt", "deleted"),
    scenario.change(path.join("new", "nested", "added.txt"), "added"),
  ];

  await scenario.mount(changes);

  assert.equal(await scenario.readProjectFile("changed.txt"), "task");
  assert.equal(scenario.projectFileExists("deleted.txt"), false);
  assert.equal(await scenario.readProjectFile("new/nested/added.txt"), "added");
  assert.equal(await scenario.readProjectSnapshot("changed.txt"), "original");
  assert.equal(scenario.snapshotContains("new/nested/added.txt"), false);

  await scenario.writeTaskFile("changed.txt", "live");
  await scenario.sync();
  assert.equal(await scenario.readProjectFile("changed.txt"), "live");

  await scenario.writeProjectFile("changed.txt", "external overwrite");
  await scenario.sync();
  assert.equal(await scenario.readProjectFile("changed.txt"), "live");

  await scenario.removeTaskFile("changed.txt");
  await scenario.sync();
  assert.equal(await scenario.readProjectFile("changed.txt"), "original");

  await scenario.unmount();
  assert.equal(await scenario.readProjectFile("changed.txt"), "original");
  assert.equal(await scenario.readProjectFile("deleted.txt"), "bring me back");
  assert.equal(scenario.projectFileExists("new/nested/added.txt"), false);
  assert.equal(scenario.projectFileExists("new"), false);
});

test("snapshots later task changes and prevents a second mount", async (t) => {
  const scenario = await createMountScenario(t);
  await scenario.writeProjectFile("first.txt", "one");
  await scenario.writeTaskFile("first.txt", "ONE");
  const firstChange = scenario.change("first.txt");
  await scenario.mount([firstChange]);

  await assert.rejects(
    scenario.mountAnotherTask([firstChange]),
    /already mounted/,
  );

  await scenario.writeProjectFile("later.txt", "two");
  await scenario.writeTaskFile("later.txt", "TWO");
  const laterChange = scenario.change("later.txt");
  scenario.setOperations([firstChange, laterChange]);
  await scenario.sync();

  assert.equal(await scenario.readProjectFile("later.txt"), "TWO");
  assert.equal(await scenario.readProjectSnapshot("later.txt"), "two");

  await scenario.unmount();
  assert.equal(await scenario.readProjectFile("later.txt"), "two");
});

test("mounts a clean task before its first change", async (t) => {
  const scenario = await createMountScenario(t);
  await scenario.writeProjectFile("future.txt", "original");

  await scenario.mount([]);

  assert.deepEqual(scenario.currentMount(), {
    workspaceId: WORKSPACE_ID,
    taskId: TASK_ID,
    taskName: "Task",
  });

  await scenario.writeTaskFile("future.txt", "first live change");
  scenario.setOperations([scenario.change("future.txt")]);
  await scenario.sync();

  assert.equal(
    await scenario.readProjectFile("future.txt"),
    "first live change",
  );
  assert.equal(await scenario.readProjectSnapshot("future.txt"), "original");

  await scenario.unmount();
  assert.equal(await scenario.readProjectFile("future.txt"), "original");
});

test("finalize keeps the mounted task changes in the project", async (t) => {
  const scenario = await createMountScenario(t);
  await scenario.writeProjectFile("feature.txt", "before");
  await scenario.writeTaskFile("feature.txt", "after");
  await scenario.mount([scenario.change("feature.txt")]);

  await scenario.finalize();

  assert.equal(await scenario.readProjectFile("feature.txt"), "after");
  assert.equal(scenario.currentMount(), undefined);
});

test("restores and unmounts a persisted mount after restart", async (t) => {
  const scenario = await createMountScenario(t);
  await scenario.writeProjectFile("restart.txt", "original");
  await scenario.writeTaskFile("restart.txt", "mounted");
  const change = scenario.change("restart.txt");
  await scenario.mount([change]);

  const restartedManager = scenario.restartManager();
  await restartedManager.initialize();

  assert.deepEqual(restartedManager.current(), {
    workspaceId: WORKSPACE_ID,
    taskId: TASK_ID,
    taskName: "Task",
  });

  await restartedManager.unmount(WORKSPACE_ID, TASK_ID);
  assert.equal(await scenario.readProjectFile("restart.txt"), "original");
});
