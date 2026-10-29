import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { approveAll, CopilotClient } from "@github/copilot-sdk";
import { copilotConnectionOption } from "./copilot-cli-path";
import { modelClientOptions, modelSessionOptions } from "./model-config";

test("pinned CLI uses the credential callback and round-trips image tools without GitHub auth or persisted keys", { timeout: 30_000 }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "azure-runtime-test-"));
  const key = "synthetic-runtime-test-key";
  const bodies: Array<Record<string, unknown>> = [];
  let authOk = true;
  let imageRead = false;
  let submitted = false;
  let remembered = false;
  const server = createServer(async (request, response) => {
    authOk &&= request.headers.authorization === `Bearer ${key}`;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    bodies.push(body);
    const toolName = !imageRead ? "get_test_image" : !submitted ? "submit_test" : bodies.length === 4 ? "submit_test" : null;
    const output = toolName
      ? [{ type: "function_call", id: `fc_${bodies.length}`, call_id: `call_${bodies.length}`, name: toolName, arguments: JSON.stringify(toolName === "submit_test" ? { answer: submitted ? "maple" : "red" } : {}), status: "completed" }]
      : [{ type: "message", id: `msg_${bodies.length}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: "Done.", annotations: [] }] }];
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ id: `resp_${bodies.length}`, object: "response", created_at: 1, status: "completed", model: "gpt-4.1", output, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const config = { provider: "azure", endpoint: "https://example.openai.azure.com", deployment: "gpt-6.1-sol", apiKey: key, wireApi: "responses", apiVersion: "" } as const;
  const options = modelSessionOptions(config);
  const client = new CopilotClient({ ...copilotConnectionOption(), ...modelClientOptions(config, root) });
  try {
    await client.start();
    const session = await client.createSession({
      ...options,
      // Test-only transport override: no external model request is ever sent.
      provider: { ...options.provider!, baseUrl: `http://127.0.0.1:${port}/v1` },
      availableTools: ["get_test_image", "submit_test"], onPermissionRequest: approveAll,
      enableHostGitOperations: false, infiniteSessions: { enabled: false },
      tools: [
        { name: "get_test_image", description: "Synthetic image", parameters: { type: "object", properties: {} }, handler: () => {
          imageRead = true;
          return { resultType: "success", textResultForLlm: "Test image", binaryResultsForLlm: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1EAAAAASUVORK5CYII=" }] };
        } },
        { name: "submit_test", description: "Submit", parameters: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] }, handler: (raw) => {
          const answer = (raw as { answer: string }).answer;
          if (!submitted) submitted = answer === "red";
          else remembered = answer === "maple";
          return "Recorded.";
        } },
      ],
    });
    await session.sendAndWait("Remember maple and inspect the image.", 10_000);
    await session.sendAndWait("Submit the remembered word.", 10_000);
    assert.ok(imageRead && submitted && remembered);
    assert.ok(authOk, "the runtime must obtain Bearer credentials through the SDK callback");
    assert.ok(JSON.stringify(bodies).includes("data:image/png;base64,"), "tool-result images must reach the model request");
    // Verify while the session is still live, not only after runtime cleanup.
    function assertNoKey(dir: string) {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name);
        if (statSync(file).isDirectory()) assertNoKey(file);
        else assert.equal(readFileSync(file).includes(Buffer.from(key)), false, `credential found in ${name}`);
      }
    }
    assertNoKey(root);
    await session.disconnect();
  } finally {
    await client.stop().catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
