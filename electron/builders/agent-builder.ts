import { CopilotClient, type CopilotSession, type SessionConfig } from "@github/copilot-sdk";

import { modelClientOptions, modelSessionOptions, modelRunError, verifyModelAccess } from "../model-config";
import { modelSettingsStore, modelRuntimeDirectory, assertModelSettingsStable } from "../model-settings-store";
import { copilotConnectionOption, withStartupTimeout } from "../copilot-cli-path";
import { createLogger } from "../logger";

/**
 * Shared plumbing for the final-stage, multi-turn Copilot builders (Skill Builder
 * and Automation Builder). Owns one lazily-started {@link CopilotClient} and a small
 * pool of live conversations — one per recording — so each build's plan → refine →
 * create flow stays in a single session. Subclasses add the build-specific tools,
 * system prompt, and `build`/`create` turns; everything below is common.
 */

/** The minimum every live build carries so the pool can manage it. */
export interface BaseLive {
  sessionId: string;
  copilot: CopilotSession;
}

const MAX_LIVE_SESSIONS = 4;

export abstract class AgentBuilder<TLive extends BaseLive> {
  private client: CopilotClient | null = null;
  private clientStart: Promise<CopilotClient> | null = null;
  protected model: string | undefined;
  protected sessionOptions: Pick<SessionConfig, "provider" | "model" | "modelCapabilities"> = {};

  hasActiveOperations(): boolean { return this.active.size > 0; }

  protected modelError(error: unknown): string { return modelRunError(error, this.sessionOptions); }
  protected readonly live = new Map<string, TLive>();
  protected readonly active = new Set<string>();
  protected readonly log;

  /** @param name Used for logs and the "not signed in" / startup-timeout messages. */
  constructor(private readonly name: string) {
    this.log = createLogger(name);
  }

  isBuilding(sessionId: string): boolean {
    return this.active.has(sessionId);
  }

  async cancel(sessionId: string): Promise<void> {
    const live = this.live.get(sessionId);
    if (live) await live.copilot.abort().catch(() => undefined);
  }

  async forget(sessionId: string): Promise<void> {
    await this.disposeLive(sessionId);
  }

  async evictIdle(): Promise<void> {
    for (const [id, live] of this.live) {
      if (this.active.has(id)) continue;
      this.live.delete(id);
      await live.copilot.disconnect().catch(() => undefined);
    }
  }

  async dispose(): Promise<void> {
    for (const [id] of this.live) await this.disposeLive(id);
    if (this.client) await this.client.stop().catch(() => undefined);
    this.client = null;
    this.clientStart = null;
  }

  /** Start (once) and return the shared Copilot client, verifying it's signed in. */
  protected async ensureClient(): Promise<CopilotClient> {
    if (this.client) return this.client;
    if (this.clientStart) return this.clientStart;
    assertModelSettingsStable();
    const config = modelSettingsStore().read();
    this.sessionOptions = modelSessionOptions(config);
    this.clientStart = (async () => {
      const client = new CopilotClient({ ...copilotConnectionOption(), ...modelClientOptions(config, modelRuntimeDirectory()) });
      try {
        await withStartupTimeout(client.start(), `Copilot CLI (${this.name})`);
        await verifyModelAccess(client, config);
      } catch (error) {
        await client.stop().catch(() => undefined);
        throw new Error(modelRunError(error, this.sessionOptions));
      }
      this.model = this.sessionOptions.model;
      this.log.info(`${config.provider} model runtime ready`);
      this.client = client;
      return client;
    })();
    try {
      return await this.clientStart;
    } catch (err) {
      this.clientStart = null;
      throw err;
    }
  }

  /** Add a freshly created live session to the pool, evicting the oldest idle one
   *  when the pool is over budget. */
  protected registerLive(live: TLive): void {
    this.live.set(live.sessionId, live);
    for (const [id, l] of this.live) {
      if (this.live.size <= MAX_LIVE_SESSIONS) break;
      if (id === live.sessionId || this.active.has(id)) continue;
      this.live.delete(id);
      void l.copilot.disconnect().catch(() => undefined);
    }
  }

  protected async disposeLive(sessionId: string): Promise<void> {
    const live = this.live.get(sessionId);
    if (!live) return;
    this.live.delete(sessionId);
    await live.copilot.disconnect().catch(() => undefined);
  }
}
