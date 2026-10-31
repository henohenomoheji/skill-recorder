import assert from "node:assert/strict";
import test from "node:test";
import { environmentModelConfig, modelClientOptions, modelSessionOptions, normalizeModelConfig, verifyModelAccess, type ModelConfig } from "./model-config";

const azure: ModelConfig = {
  provider: "azure", endpoint: "https://example.openai.azure.com/openai/v1/",
  deployment: "my-vision-deployment", apiKey: "synthetic-test-key", apiVersion: "", wireApi: "responses",
};

test("Azure resource hosts and v1 endpoints use v1 routing and the deployment name", async () => {
  const v1 = modelSessionOptions(azure);
  assert.equal(v1.model, "my-vision-deployment");
  assert.equal(v1.provider?.type, "openai");
  assert.equal(v1.provider?.baseUrl, "https://example.openai.azure.com/openai/v1");
  assert.equal(v1.provider?.wireApi, "responses");
  assert.equal(v1.provider?.apiKey, undefined);
  assert.equal(v1.provider?.bearerToken, undefined);
  assert.equal(await v1.provider?.bearerTokenProvider?.({ providerName: "default", sessionId: "test" }), azure.apiKey);
  assert.equal(JSON.stringify(v1).includes(azure.apiKey!), false);
  const native = modelSessionOptions({ ...azure, endpoint: "https://example.openai.azure.com/", wireApi: "completions" });
  assert.equal(native.provider?.type, "openai");
  assert.equal(native.provider?.baseUrl, "https://example.openai.azure.com/openai/v1");
  assert.equal(native.provider?.wireApi, "completions");
});

test("invalid endpoint and credential configurations fail before starting the runtime", () => {
  for (const endpoint of ["http://example.openai.azure.com", "https://example.com", "https://example.openai.azure.com.evil.com", "https://key@example.openai.azure.com", "https://example.openai.azure.com?api-key=secret", "https://example.openai.azure.com/openai/deployments/model", "https://example.openai.azure.com:8443"]) {
    assert.throws(() => normalizeModelConfig({ ...azure, endpoint }));
  }
  assert.throws(() => normalizeModelConfig({ ...azure, apiKey: "" }), /API key/);
  assert.throws(() => normalizeModelConfig({ ...azure, deployment: "" }), /deployment/);
  assert.throws(() => normalizeModelConfig({ ...azure, apiVersion: "2024-10-21" }), /version empty/);
  assert.throws(() => normalizeModelConfig({ ...azure, provider: "unknown" }));
});

test("Azure skips GitHub authentication; Copilot retains the existing authentication check", async () => {
  let authCalls = 0;
  const client = { getAuthStatus: async () => { authCalls++; return { isAuthenticated: false }; } };
  await verifyModelAccess(client, azure);
  assert.equal(authCalls, 0);
  await assert.rejects(verifyModelAccess(client, { ...azure, provider: "copilot" }), /isn't signed in/);
  assert.equal(authCalls, 1);
});

test("Azure runtime does not inherit ambient GitHub or provider credentials", (t) => {
  const names = ["GITHUB_TOKEN", "GH_TOKEN", "COPILOT_GITHUB_TOKEN", "COPILOT_PROVIDER_BASE_URL", "AZURE_OPENAI_API_KEY"];
  const old = { ...process.env };
  t.after(() => { for (const name of names) { if (old[name] === undefined) delete process.env[name]; else process.env[name] = old[name]; } });
  for (const name of names) process.env[name] = "synthetic-secret";
  const options = modelClientOptions(azure, "/synthetic-runtime");
  assert.equal(options.useLoggedInUser, false);
  assert.equal(options.mode, "empty");
  assert.equal(options.baseDirectory, "/synthetic-runtime");
  for (const name of names) assert.equal(options.env?.[name], undefined);
  assert.equal(options.logLevel, "none");
});

test("environment configuration is explicit and never silently falls back on invalid settings", () => {
  assert.equal(environmentModelConfig({}), null);
  assert.equal(environmentModelConfig({ AZURE_OPENAI_DEPLOYMENT: "deployment" })?.provider, "azure");
  assert.equal(environmentModelConfig({ SKILL_RECORDER_PROVIDER: "copilot" })?.provider, "copilot");
  assert.throws(() => environmentModelConfig({ SKILL_RECORDER_PROVIDER: "azuer" }), /must be/);
  assert.throws(() => environmentModelConfig({ AZURE_OPENAI_WIRE_API: "invalid" }), /must be/);
});
