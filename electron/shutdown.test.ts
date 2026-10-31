import assert from "node:assert/strict";
import test from "node:test";
import { ShutdownCoordinator } from "./shutdown";

test("quit requests share a drain and never exit before recording writes complete", async () => {
  let finish!: () => void;
  const saved = new Promise<void>((resolve) => { finish = resolve; });
  const order: string[] = [];
  const shutdown = new ShutdownCoordinator({
    confirm: async () => true,
    drain: async () => { order.push("drain"); await saved; order.push("saved"); },
    cleanup: async () => { order.push("cleanup"); },
    exit: () => { order.push("exit"); }, report: () => assert.fail("unexpected failure"),
  });
  const first = shutdown.request();
  assert.equal(shutdown.request(), first);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(shutdown.requested, true);
  assert.deepEqual(order, ["drain"]);
  finish();
  await first;
  assert.deepEqual(order, ["drain", "saved", "cleanup", "exit"]);
});

test("canceling quit leaves the recorder usable and permits another quit attempt", async () => {
  let approved = false;
  let drained = 0;
  const shutdown = new ShutdownCoordinator({
    confirm: async () => approved, drain: async () => { drained++; },
    cleanup: async () => undefined, exit: () => undefined, report: () => undefined,
  });
  await shutdown.request();
  assert.equal(shutdown.requested, false);
  assert.equal(drained, 0);
  approved = true;
  await shutdown.request();
  assert.equal(drained, 1);
});

test("a stuck background worker cannot leave a shutdown-only app after recording data is safe", async () => {
  let exited = false;
  const failures: unknown[] = [];
  const shutdown = new ShutdownCoordinator({
    confirm: async () => true, drain: async () => undefined,
    cleanup: () => new Promise<void>(() => undefined),
    exit: () => { exited = true; }, report: (error) => failures.push(error), cleanupTimeoutMs: 10,
  });
  await shutdown.request();
  assert.equal(exited, true);
  assert.equal(failures.length, 1);
});

test("a failed recording drain cancels shutdown without disposing services or exiting", async () => {
  let approved = false;
  let exits = 0;
  const shutdown = new ShutdownCoordinator({
    confirm: async () => true,
    drain: async () => { if (!approved) throw new Error("Recording write failed"); },
    cleanup: async () => { assert.ok(approved); },
    exit: () => { exits++; }, report: () => undefined,
  });
  await shutdown.request();
  assert.equal(shutdown.requested, false);
  assert.equal(exits, 0);
  approved = true;
  await shutdown.request();
  assert.equal(exits, 1);
});
