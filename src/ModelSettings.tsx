import { useEffect, useState } from "react";
import type { ModelSettingsInput, ModelSettingsView } from "../common/model-settings";

export function useModelSettings() {
  const [settings, setSettings] = useState<ModelSettingsView | null>(null);
  useEffect(() => {
    let mounted = true;
    void window.skillRecorder.modelSettings().then((value) => { if (mounted) setSettings(value); }).catch(() => undefined);
    const unsubscribe = window.skillRecorder.onModelSettingsChanged(setSettings);
    return () => { mounted = false; unsubscribe(); };
  }, []);
  return settings;
}

export function AnalysisDestination() {
  const settings = useModelSettings();
  if (!settings) return <>the AI provider selected in AI settings</>;
  return settings.provider === "azure"
    ? <>Azure OpenAI{settings.endpoint ? ` (${settings.endpoint})` : " configured in AI settings"}</>
    : <>GitHub Copilot</>;
}

export function ModelSettings({ disabled = false }: { disabled?: boolean }) {
  const settings = useModelSettings();
  const [draft, setDraft] = useState<ModelSettingsInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (settings) setDraft({ ...settings, apiKey: "" }); }, [settings]);

  async function save() {
    if (!draft) return;
    setBusy(true); setMessage("");
    try {
      const result = await window.skillRecorder.saveModelSettings(draft);
      setFailed(!result.ok);
      if (result.ok) {
        setDraft({ ...result.settings, apiKey: "" });
        setMessage("Saved. New AI operations use these settings. Test the saved connection below.");
      } else setMessage(result.error);
    } catch { setFailed(true); setMessage("Could not save AI settings."); }
    finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setMessage("Testing saved connection… This may take up to two minutes.");
    try {
      const result = await window.skillRecorder.testModelConnection();
      setFailed(!result.ok); setMessage(result.message);
    } catch { setFailed(true); setMessage("Could not test the saved connection."); }
    finally { setBusy(false); }
  }

  return (
    <details className="model-settings" open={open} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} onToggle={(event) => {
      const next = event.currentTarget.open;
      setOpen(next);
      if (!next) setDraft((value) => value ? { ...value, apiKey: "" } : null);
    }}>
      <summary>{open ? "Close AI settings" : "AI settings"} · {settings?.provider === "copilot" ? "GitHub Copilot" : "Azure OpenAI"}</summary>
      {!draft ? <p>Could not load AI settings. Check the app configuration and restart.</p> : (
        <>
          <p>Recording stays local. Analyze sends selected recording data to the provider shown here.</p>
          {settings?.source === "environment" && <p>Configured by environment variables. Remove them and restart to edit here.</p>}
          <fieldset disabled={busy || disabled || settings?.source === "environment"}>
            <label>Provider
              <select value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value as ModelSettingsInput["provider"] })}>
                <option value="azure">Azure OpenAI</option>
                <option value="copilot">GitHub Copilot</option>
              </select>
            </label>
            {draft.provider === "azure" && <>
              <label>Azure endpoint
                <input type="url" placeholder="https://your-resource.openai.azure.com/openai/v1/" value={draft.endpoint} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} spellCheck={false} />
              </label>
              <label>Deployment name
                <input value={draft.deployment} onChange={(event) => setDraft({ ...draft, deployment: event.target.value })} spellCheck={false} />
              </label>
              <label>API format
                <select value={draft.wireApi} onChange={(event) => setDraft({ ...draft, wireApi: event.target.value as ModelSettingsInput["wireApi"] })}>
                  <option value="responses">Responses</option>
                  <option value="completions">Chat Completions</option>
                </select>
              </label>
              <p>Uses Azure OpenAI v1. A resource-host URL is automatically extended with /openai/v1/.</p>
              <label>API key
                <input type="password" autoComplete="off" value={draft.apiKey ?? ""} placeholder={settings?.hasApiKey ? "Saved securely · leave blank to keep" : "Enter API key"} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} />
              </label>
              <p>The key is encrypted using macOS Keychain-backed storage. It is never returned to this screen.</p>
            </>}
            {draft.provider === "copilot" && settings?.hasApiKey && <label>
              <span><input className="model-key-clear" type="checkbox" checked={draft.clearApiKey ?? false} onChange={(event) => setDraft({ ...draft, clearApiKey: event.target.checked })} /> Remove saved Azure key</span>
            </label>}
            <button className="secondary" onClick={() => void save()}>Save settings</button>
          </fieldset>
          <button className="secondary" disabled={busy || disabled || !settings || (settings.provider === "azure" && !settings.hasApiKey)} onClick={() => void test()}>
            {busy ? "Working…" : "Test saved connection"}
          </button>
          <p>Connection tests send a synthetic image and text, and incur model usage. They send no recordings. Save edits before testing.</p>
          {message && <p role={failed ? "alert" : "status"} className={failed ? "analysis-error" : ""}>{message}</p>}
        </>
      )}
    </details>
  );
}
