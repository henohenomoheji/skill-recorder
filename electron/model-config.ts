import type { CopilotClient, CopilotClientOptions, ProviderConfig, SessionConfig } from "@github/copilot-sdk";
import type { ModelSettingsInput } from "../common/model-settings";
import { COPILOT_SIGNED_OUT_ERROR } from "../common/ipc";

export interface ModelConfig extends Omit<ModelSettingsInput, "clearApiKey"> {}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  provider: "azure", endpoint: "", deployment: "", wireApi: "responses", apiVersion: "",
};

/** Treat environment configuration as a whole so keys cannot cross resources. */
export function environmentModelConfig(env: NodeJS.ProcessEnv): ModelConfig | null {
  const names = ["SKILL_RECORDER_PROVIDER", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_DEPLOYMENT", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_API_VERSION", "AZURE_OPENAI_WIRE_API"];
  if (!names.some((name) => env[name] !== undefined)) return null;
  const provider = env.SKILL_RECORDER_PROVIDER ?? "azure";
  if (provider !== "azure" && provider !== "copilot") throw new Error("SKILL_RECORDER_PROVIDER must be azure or copilot.");
  const wireApi = env.AZURE_OPENAI_WIRE_API ?? "responses";
  if (wireApi !== "responses" && wireApi !== "completions") throw new Error("AZURE_OPENAI_WIRE_API must be responses or completions.");
  return {
    provider, endpoint: env.AZURE_OPENAI_ENDPOINT ?? "", deployment: env.AZURE_OPENAI_DEPLOYMENT ?? "",
    apiKey: env.AZURE_OPENAI_API_KEY, apiVersion: env.AZURE_OPENAI_API_VERSION ?? "", wireApi,
  };
}

/** Validate at the IPC boundary as well as before starting a runtime. */
export function normalizeModelConfig(input: unknown): ModelConfig {
  if (!input || typeof input !== "object") throw new Error("Invalid model settings.");
  const value = input as Record<string, unknown>;
  if (value.provider !== "azure" && value.provider !== "copilot") throw new Error("Choose Azure OpenAI or GitHub Copilot.");
  if (value.wireApi !== "responses" && value.wireApi !== "completions") throw new Error("Choose a supported API format.");
  for (const name of ["endpoint", "deployment", "apiVersion"]) {
    if (typeof value[name] !== "string") throw new Error(`Invalid ${name} setting.`);
  }
  if (value.apiKey !== undefined && typeof value.apiKey !== "string") throw new Error("Invalid API key.");
  const config: ModelConfig = {
    provider: value.provider, endpoint: (value.endpoint as string).trim(),
    deployment: (value.deployment as string).trim(), wireApi: value.wireApi,
    apiVersion: (value.apiVersion as string).trim(), apiKey: (value.apiKey as string | undefined)?.trim(),
  };
  if (config.provider === "copilot") return config;
  let url: URL;
  try { url = new URL(config.endpoint); } catch { throw new Error("Enter the Azure OpenAI HTTPS endpoint in AI settings."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.port && url.port !== "443")) {
    throw new Error("The Azure endpoint must use HTTPS without credentials, query parameters, or a custom port.");
  }
  // Accept sovereign Azure clouds too. Custom gateways need an explicit future adapter.
  if (![".openai.azure.com", ".openai.azure.us", ".openai.azure.cn"].some((suffix) => url.hostname.endsWith(suffix))) {
    throw new Error("Use an Azure OpenAI resource endpoint (*.openai.azure.com, *.openai.azure.us, or *.openai.azure.cn).");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname !== "" && pathname !== "/openai/v1") throw new Error("Use the resource host or its /openai/v1/ endpoint, without a deployment path.");
  if (config.apiVersion) throw new Error("This Azure integration uses the v1 API. Leave API version empty.");
  if (!config.deployment || /[\s/?#]/.test(config.deployment)) throw new Error("Enter your Azure deployment name in AI settings.");
  if (!config.apiKey) throw new Error("Enter an Azure OpenAI API key in AI settings.");
  config.endpoint = `${url.origin}/openai/v1`;
  return config;
}

export function modelSessionOptions(config: ModelConfig): Pick<SessionConfig, "provider" | "model" | "modelCapabilities"> {
  const validated = normalizeModelConfig(config);
  if (validated.provider === "copilot") return process.env.SKILL_RECORDER_MODEL ? { model: process.env.SKILL_RECORDER_MODEL } : {};
  const provider: ProviderConfig = {
    type: "openai", baseUrl: validated.endpoint, wireApi: validated.wireApi,
    // Azure v1 accepts API keys as Bearer credentials. A callback keeps the key
    // out of serialized runtime configuration, which the CLI can write to disk.
    bearerTokenProvider: async () => validated.apiKey!,
  };
  return { model: validated.deployment, provider, modelCapabilities: { supports: { vision: true } } };
}

export function modelClientOptions(config: ModelConfig, runtimeDirectory: string): CopilotClientOptions {
  if (config.provider === "copilot") return {};
  const env = { ...process.env };
  // BYOK must not inherit a GitHub identity or ambient provider overrides.
  for (const key of Object.keys(env)) {
    if (/^(GITHUB_TOKEN|GH_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_COPILOT_API_TOKEN|COPILOT_.*|AZURE_OPENAI_API_KEY)$/.test(key)) delete env[key];
  }
  return { useLoggedInUser: false, env, logLevel: "none", mode: "empty", baseDirectory: runtimeDirectory };
}

/** Azure never runs a GitHub auth probe or a GitHub model-list request. */
export async function verifyModelAccess(client: Pick<CopilotClient, "getAuthStatus">, config: ModelConfig): Promise<void> {
  if (config.provider === "azure") return;
  if (!(await client.getAuthStatus()).isAuthenticated) throw new Error(COPILOT_SIGNED_OUT_ERROR);
}

/** Avoid forwarding provider errors that can echo headers or a request body. */
export function modelRunError(error: unknown, options: Pick<SessionConfig, "provider">): string {
  if (options.provider) return "Azure OpenAI request failed. Check the deployment, credentials, quota, API format, and model image/tool support.";
  return error instanceof Error ? error.message : String(error);
}
