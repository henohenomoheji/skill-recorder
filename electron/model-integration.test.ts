import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CopilotClient, CopilotSession, type SessionConfig } from "@github/copilot-sdk";
import { Describer } from "./describer/describer";
import { SkillBuilder } from "./skillbuilder/builder";
import { AutomationBuilder } from "./automationbuilder/builder";
import { setModelSettingsChanging } from "./model-settings-store";

test("Azure routes analysis, feedback, skill preview/export and automation through the configured provider", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "azure-integration-"));
  const env = {
    SKILL_RECORDER_PROVIDER: "azure", AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com/openai/v1/",
    AZURE_OPENAI_DEPLOYMENT: "my-deployment", AZURE_OPENAI_API_KEY: "synthetic-secret",
    AZURE_OPENAI_WIRE_API: "responses", AZURE_OPENAI_API_VERSION: "",
    SKILL_RECORDER_SESSIONS_DIR: path.join(root, "sessions"), SKILL_RECORDER_AUTOMATIONS_DIR: path.join(root, "automations"),
  };
  const before = { ...process.env };
  Object.assign(process.env, env);
  const describer = new Describer(() => undefined);
  const builder = new SkillBuilder(() => undefined);
  const automation = new AutomationBuilder(() => undefined);
  t.after(async () => {
    await Promise.all([describer.dispose(), builder.dispose(), automation.dispose()]);
    for (const key of Object.keys(env)) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
    setModelSettingsChanging(false);
    rmSync(root, { recursive: true, force: true });
  });
  const id = "azure-fixture";
  const dir = path.join(env.SKILL_RECORDER_SESSIONS_DIR, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "session.json"), JSON.stringify({ id, startedAt: 0, stoppedAt: 1, platform: "darwin", appVersion: "0.7.0" }));
  const configs: SessionConfig[] = [];
  let analysisTurns = 0;
  t.mock.method(CopilotClient.prototype, "start", async () => undefined);
  t.mock.method(CopilotClient.prototype, "stop", async () => []);
  t.mock.method(CopilotClient.prototype, "getAuthStatus", () => { assert.fail("Azure must never probe GitHub authentication"); });
  t.mock.method(CopilotClient.prototype, "listModels", () => { assert.fail("Azure must never query the GitHub model catalog"); });
  t.mock.method(CopilotClient.prototype, "createSession", async (config: SessionConfig) => {
    configs.push(config);
    const session = new CopilotSession();
    t.mock.method(session, "abort", async () => undefined);
    t.mock.method(session, "disconnect", async () => undefined);
    t.mock.method(session, "sendAndWait", async (input: string | { prompt: string }) => {
      const prompt = typeof input === "string" ? input : input.prompt;
      let toolName: string;
      let payload: unknown;
      if (config.tools?.some((tool) => tool.name === "submit_analysis")) {
        analysisTurns++;
        toolName = "submit_analysis";
        payload = { intent: "List issues", title: "List issues", steps: [] };
      } else if (config.tools?.some((tool) => tool.name === "propose_automation_plan")) {
        toolName = "propose_automation_plan";
        payload = { name: "list-issues", title: "List issues", description: "List issues daily", trigger: { schedule: { kind: "single", time: { hour: 9, minute: 0 } } }, steps: [{ label: "List", prompt: "List issues" }] };
      } else if (prompt.includes("Call submit_skill")) {
        toolName = "submit_skill";
        payload = { name: "list-issues", description: "List issues", allowedTools: [], body: "# Steps\n\nList issues using the available repository tools." };
      } else {
        toolName = "propose_plan";
        payload = { name: "list-issues", title: "List issues", description: "List issues", values: [], steps: [] };
      }
      const tool = config.tools?.find((candidate) => candidate.name === toolName);
      assert.ok(tool?.handler);
      await tool.handler(payload, { sessionId: id, toolCallId: "synthetic-call", toolName, arguments: payload });
      return undefined;
    });
    return session;
  });
  await describer.analyze(id);
  await describer.feedback(id, { overall: "Clarify the goal", steps: [] });
  assert.equal(analysisTurns, 2);
  const plan = await builder.build({ sessionId: id, architecture: "agent-skill" });
  const preview = await builder.prepare(id, plan);
  const exported = await builder.create(id, plan, { kind: "export", dir: path.join(root, "export") }, preview.id);
  assert.ok(exported);
  assert.equal(readFileSync(exported.path, "utf8"), preview.markdown);
  const automationPlan = await automation.build({ sessionId: id, architecture: "scout" });
  const automated = await automation.create(id, automationPlan);
  assert.ok(automated);
  assert.equal(configs.length, 3);
  for (const config of configs) {
    assert.equal(config.provider?.baseUrl, "https://example.openai.azure.com/openai/v1");
    assert.equal(config.provider?.apiKey, undefined);
    assert.equal(await config.provider?.bearerTokenProvider?.({ providerName: "default", sessionId: "test" }), "synthetic-secret");
    assert.equal(config.model, "my-deployment");
    assert.deepEqual(config.availableTools, config.tools?.map((tool) => tool.name));
    assert.equal(config.enableHostGitOperations, false);
  }
  setModelSettingsChanging(true);
  await assert.rejects(describer.analyze(id), /settings are changing/);
  await assert.rejects(builder.build({ sessionId: id, architecture: "agent-skill" }), /settings are changing/);
});
