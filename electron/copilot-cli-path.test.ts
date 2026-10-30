import assert from "node:assert/strict";
import test from "node:test";
import { executableOnDisk } from "./copilot-cli-path";

test("packaged CLI resolves to the unpacked executable rather than the ASAR virtual file", () => {
  const virtual = "/Applications/Skill Recorder Azure.app/Contents/Resources/app.asar/node_modules/copilot/copilot";
  const physical = virtual.replace("app.asar/", "app.asar.unpacked/");
  assert.equal(executableOnDisk(virtual, (file) => file === virtual || file === physical), physical);
  assert.equal(executableOnDisk(virtual, (file) => file === virtual), undefined);
});

test("CLI path conversion supports Windows and leaves source-checkout paths unchanged", () => {
  const win = "C:\\Program Files\\Recorder\\resources\\app.asar\\node_modules\\copilot\\copilot.exe";
  assert.equal(executableOnDisk(win, () => true), win.replace("app.asar\\", "app.asar.unpacked\\"));
  assert.equal(executableOnDisk("/source/node_modules/copilot", () => true), "/source/node_modules/copilot");
  assert.equal(executableOnDisk("/missing/copilot", () => false), undefined);
});
