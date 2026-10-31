import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { app, safeStorage } from "electron";
import type { ModelSettingsInput, ModelSettingsView } from "../common/model-settings";
import { DEFAULT_MODEL_CONFIG, environmentModelConfig, normalizeModelConfig, type ModelConfig } from "./model-config";

interface SecretStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
interface StoredConfig extends Omit<ModelConfig, "apiKey"> { encryptedApiKey?: string }

export class ModelSettingsStore {
  constructor(private readonly file: string, private readonly secrets: SecretStorage, private readonly env: NodeJS.ProcessEnv = process.env) {}

  private stored(): StoredConfig | null {
    if (!existsSync(this.file)) return null;
    try { return JSON.parse(readFileSync(this.file, "utf8")) as StoredConfig; }
    catch { throw new Error("AI settings could not be read. Restore or remove model-settings.json and configure Azure again."); }
  }

  read(): ModelConfig {
    const environment = environmentModelConfig(this.env);
    if (environment) return environment;
    const saved = this.stored();
    if (!saved) return { ...DEFAULT_MODEL_CONFIG };
    const { encryptedApiKey, ...config } = saved;
    try {
      return { ...config, apiKey: encryptedApiKey ? this.secrets.decryptString(Buffer.from(encryptedApiKey, "base64")) : undefined };
    } catch { throw new Error("The saved Azure key could not be unlocked. Check macOS Keychain access and save the key again."); }
  }

  view(): ModelSettingsView {
    const environment = environmentModelConfig(this.env);
    const saved = environment ? null : this.stored();
    const config = environment ?? saved ?? DEFAULT_MODEL_CONFIG;
    return {
      provider: config.provider, endpoint: config.endpoint, deployment: config.deployment,
      wireApi: config.wireApi, apiVersion: config.apiVersion,
      hasApiKey: Boolean(environment ? environment.apiKey : saved?.encryptedApiKey),
      source: environment ? "environment" : saved ? "saved" : "default",
    };
  }

  save(input: ModelSettingsInput): ModelSettingsView {
    if (environmentModelConfig(this.env)) throw new Error("AI settings are controlled by environment variables. Remove them and restart to use saved settings.");
    // Validate the IPC payload before consulting its fields.
    if (!input || typeof input !== "object" || (input.clearApiKey !== undefined && typeof input.clearApiKey !== "boolean")) throw new Error("Invalid model settings.");
    const old = this.stored();
    let apiKey = input.apiKey;
    if (!input.clearApiKey && !apiKey && old?.encryptedApiKey) {
      apiKey = this.secrets.decryptString(Buffer.from(old.encryptedApiKey, "base64"));
    }
    if (input.clearApiKey) apiKey = undefined;
    const { apiKey: validatedKey, ...config } = normalizeModelConfig({ ...input, apiKey });
    if (config.provider === "azure" && old?.encryptedApiKey && !input.apiKey &&
        new URL(config.endpoint).origin !== new URL(old.endpoint).origin) {
      throw new Error("Enter a new API key when changing the Azure resource endpoint.");
    }
    if (validatedKey && !this.secrets.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable. Unlock macOS Keychain and try again.");
    const saved: StoredConfig = {
      ...config,
      ...(validatedKey ? { encryptedApiKey: this.secrets.encryptString(validatedKey).toString("base64") } : {}),
    };
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(saved, null, 2), { mode: 0o600, flag: "wx" });
    renameSync(temporary, this.file);
    return this.view();
  }
}

/** Resolve userData lazily, after Electron is ready. Evals use their headless stub. */
export function modelSettingsStore(): ModelSettingsStore {
  return new ModelSettingsStore(path.join(app.getPath("userData"), "model-settings.json"), safeStorage);
}

export function modelRuntimeDirectory(): string {
  return path.join(app.getPath("userData"), "azure-runtime");
}

let settingsChanging = false;
export function assertModelSettingsStable(): void {
  if (settingsChanging) throw new Error("AI settings are changing. Try again in a moment.");
}
export function setModelSettingsChanging(value: boolean): void { settingsChanging = value; }
