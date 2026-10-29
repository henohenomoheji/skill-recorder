/** Renderer-visible settings deliberately never include a credential. */
export interface ModelSettingsInput {
  provider: "azure" | "copilot";
  endpoint: string;
  deployment: string;
  wireApi: "responses" | "completions";
  apiVersion: string;
  /** Empty means keep the saved key. Only sent from the settings form to main. */
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface ModelSettingsView extends Omit<ModelSettingsInput, "apiKey" | "clearApiKey"> {
  hasApiKey: boolean;
  source: "environment" | "saved" | "default";
}

export type ModelSettingsResult = { ok: true; settings: ModelSettingsView } | { ok: false; error: string };
export type ModelConnectionResult = { ok: boolean; message: string };
