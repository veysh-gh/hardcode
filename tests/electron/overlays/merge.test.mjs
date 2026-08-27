import assert from "node:assert/strict";
import test from "node:test";
import { createMergeScenario } from "../../helpers/overlay-merge-scenario.mjs";

test("combines task and original edits when they touch different lines", async (t) => {
  const scenario = await createMergeScenario(t, "one\ntwo\nthree\n");
  await scenario.updateTask("ONE\ntwo\nthree\n");
  await scenario.updateOriginal("one\ntwo\nTHREE\n");

  const result = await scenario.synchronize();

  assert.deepEqual(result, { conflict: false });
  assert.equal(await scenario.readTaskFile(), "ONE\ntwo\nTHREE\n");
  assert.equal(await scenario.readBase(), "one\ntwo\nTHREE\n");
  assert.deepEqual(await scenario.inspect(), {
    type: "modified",
    conflict: false,
  });
});

test("records a conflict when task and original edit the same text", async (t) => {
  const scenario = await createMergeScenario(t, "before\n");
  await scenario.updateTask("task\n");
  await scenario.updateOriginal("original\n");

  const result = await scenario.synchronize();
  const conflict = await scenario.readConflict();

  assert.deepEqual(result, { conflict: true, stale: false });
  assert.equal(await scenario.readTaskFile(), "task\n");
  assert.equal(conflict.baseContent, "before\n");
  assert.equal(conflict.taskContent, "task\n");
  assert.equal(conflict.originalContent, "original\n");
  assert.equal(conflict.resultContent, "task\n");
  assert.equal(conflict.stale, false);
  assert.equal(scenario.conflictMarkerExists(), true);
  assert.deepEqual(await scenario.inspect(), {
    type: "modified",
    conflict: true,
  });
});

test("turns task deletion versus original edit into a conflict", async (t) => {
  const scenario = await createMergeScenario(t, "before\n");
  await scenario.markTaskFileDeleted();
  await scenario.updateOriginal("changed outside\n");

  const result = await scenario.synchronize();

  assert.deepEqual(result, { conflict: true, stale: false });
  assert.equal(scenario.taskDeletionMarkerExists(), false);
  assert.equal(await scenario.readTaskFile(), "");
});

test("detects when task and original add the same file", async (t) => {
  const scenario = await createMergeScenario(t, undefined);
  await scenario.updateTask("task addition\n");
  await scenario.updateOriginal("outside addition\n");

  const result = await scenario.synchronize();

  assert.deepEqual(result, { conflict: true, stale: false });
  assert.deepEqual(await scenario.inspect(), {
    type: "added",
    conflict: true,
  });
});

test("marks a conflict stale when the original changes again", async (t) => {
  const scenario = await createMergeScenario(t, "before\n");
  await scenario.updateTask("task\n");
  await scenario.updateOriginal("original one\n");
  await scenario.synchronize();
  const firstConflict = await scenario.readConflict();

  await scenario.updateOriginal("original two\n");
  const result = await scenario.synchronize();
  const updatedConflict = await scenario.readConflict();

  assert.deepEqual(result, { conflict: true, stale: true });
  assert.equal(updatedConflict.originalContent, "original two\n");
  assert.equal(updatedConflict.resultContent, "task\n");
  assert.equal(updatedConflict.stale, true);
  assert.notEqual(updatedConflict.revision, firstConflict.revision);
});

test("only resolves a conflict against its latest revision", async (t) => {
  const scenario = await createMergeScenario(t, "before\n");
  await scenario.updateTask("task\n");
  await scenario.updateOriginal("original\n");
  await scenario.synchronize();
  const outdatedConflict = await scenario.readConflict();

  await scenario.updateOriginal("original again\n");
  await assert.rejects(
    scenario.resolveConflict("outdated result\n", outdatedConflict.revision),
    /original changed again/i,
  );

  const currentConflict = await scenario.readConflict();
  await scenario.resolveConflict(
    "task and original\n",
    currentConflict.revision,
  );

  assert.deepEqual(await scenario.inspect(), {
    type: "modified",
    conflict: false,
  });
  assert.equal(await scenario.readTaskFile(), "task and original\n");
  assert.equal(scenario.conflictMarkerExists(), false);
});

test("removes a redundant overlay when only the original changed", async (t) => {
  const scenario = await createMergeScenario(t, "before\n");
  await scenario.updateTask("before\n");
  await scenario.updateOriginal("outside\n");

  const result = await scenario.synchronize();

  assert.deepEqual(result, { conflict: false });
  assert.equal(scenario.taskFileExists(), false);
  assert.equal(await scenario.inspect(), undefined);
});
