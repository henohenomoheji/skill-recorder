import { approveAll, CopilotClient, type CopilotSession, type Tool } from "@github/copilot-sdk";
import type { ModelConnectionResult } from "../common/model-settings";
import { copilotConnectionOption, withStartupTimeout } from "./copilot-cli-path";
import { modelClientOptions, modelSessionOptions, verifyModelAccess, type ModelConfig } from "./model-config";
import { modelRuntimeDirectory } from "./model-settings-store";

/** No recordings are sent. Exercises image tool results, submission, and a follow-up turn. */
export async function testModelConnection(config: ModelConfig): Promise<ModelConnectionResult> {
  const options = modelSessionOptions(config);
  const client = new CopilotClient({ ...copilotConnectionOption(), ...modelClientOptions(config, modelRuntimeDirectory()) });
  let session: CopilotSession | undefined;
  try {
    await withStartupTimeout(client.start(), "AI connection test");
    await verifyModelAccess(client, config);
    // An opaque red square, created locally; no user data is included.
    const { default: sharp } = await import("sharp");
    const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#ff0000" } }).png().toBuffer();
    let imageRead = false;
    let submitted = false;
    let followup = false;
    const tools: Tool[] = [
      {
        name: "get_test_image", description: "View the synthetic test image.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        handler: () => {
          imageRead = true;
          return { textResultForLlm: "Describe the dominant color of this test image.", resultType: "success", binaryResultsForLlm: [{ type: "image", mimeType: "image/png", data: image.toString("base64") }] };
        },
      },
      {
        name: "submit_test", description: "Submit the image color, or the remembered word on the follow-up turn.",
        parameters: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false },
        handler: (raw) => {
          const answer = String((raw as { answer?: unknown })?.answer ?? "").toLowerCase();
          if (!submitted) submitted = imageRead && answer.includes("red");
          else followup = answer.includes("maple");
          return "Test result recorded. Stop this turn.";
        },
      },
    ];
    session = await client.createSession({
      ...options, tools, availableTools: tools.map((tool) => tool.name),
      systemMessage: { mode: "append", content: "Use only the supplied test tools. Never use the filesystem or network tools." },
      onPermissionRequest: approveAll, enableHostGitOperations: false, infiniteSessions: { enabled: false },
    });
    await session.sendAndWait("Remember the word maple. Call get_test_image, then submit_test with the dominant color you see. Stop after submitting.", 60_000);
    if (!submitted) throw new Error("The model did not complete the image and tool-call test.");
    await session.sendAndWait("Call submit_test with the word I asked you to remember in the previous turn. Stop after submitting.", 30_000);
    if (!followup) throw new Error("The model did not complete the follow-up conversation test.");
    return { ok: true, message: "Connected. Image input, tool calls, and follow-up conversation passed. No recordings were sent." };
  } catch {
    // Provider errors may contain request bodies or credentials; never forward them.
    return { ok: false, message: "Connection test failed. Check the endpoint, deployment, key, API format, model image/tool support, and Azure quota. No recordings were sent." };
  } finally {
    await session?.abort().catch(() => undefined);
    await session?.disconnect().catch(() => undefined);
    await client.stop().catch(() => undefined);
  }
}
