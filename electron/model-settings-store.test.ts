import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ModelSettingsStore } from "./model-settings-store";

const input = { provider: "azure" as const, endpoint: "https://example.openai.azure.com/openai/v1/", deployment: "vision", wireApi: "responses" as const, apiVersion: "", apiKey: "synthetic-secret" };
// Test-only cipher: verifies the storage boundary without invoking real Keychain.
const secrets = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(value.split("").reverse().join("")),
  decryptString: (value: Buffer) => value.toString().split("").reverse().join(""),
};

test("only encrypted credentials persist; renderer views never contain the key", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "model-settings-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "settings.json");
  const store = new ModelSettingsStore(file, secrets, {});
  assert.equal(store.view().source, "default");
  const view = store.save(input);
  assert.equal(view.hasApiKey, true);
  assert.equal(JSON.stringify(view).includes(input.apiKey), false);
  assert.equal(readFileSync(file, "utf8").includes(input.apiKey), false);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(new ModelSettingsStore(file, secrets, {}).read().apiKey, input.apiKey);
  store.save({ ...input, deployment: "another", apiKey: "" });
  assert.equal(store.read().apiKey, input.apiKey);
  assert.equal(store.read().deployment, "another");
  assert.throws(() => store.save({ ...input, endpoint: "https://other.openai.azure.com", apiKey: "" }), /new API key/);
  store.save({ ...input, provider: "copilot", apiKey: "", clearApiKey: true });
  assert.equal(store.read().apiKey, undefined);
  assert.equal(store.view().hasApiKey, false);
});

test("unavailable secure storage fails closed and never writes a plaintext key", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "model-settings-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new ModelSettingsStore(path.join(dir, "settings.json"), { ...secrets, isEncryptionAvailable: () => false }, {});
  assert.throws(() => store.save(input), /Secure credential storage/);
  assert.equal(store.view().hasApiKey, false);
});

test("environment settings override saved settings as a whole, without mixing keys", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "model-settings-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "settings.json");
  new ModelSettingsStore(file, secrets, {}).save(input);
  const envStore = new ModelSettingsStore(file, secrets, { AZURE_OPENAI_ENDPOINT: "https://other.openai.azure.com" });
  assert.equal(envStore.read().apiKey, undefined);
  assert.equal(envStore.view().source, "environment");
  assert.equal(envStore.view().hasApiKey, false);
  assert.throws(() => envStore.save(input), /environment variables/);
});
