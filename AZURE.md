# Skill Recorder Azure for macOS

This fork uses Azure OpenAI for recording analysis and Skill/Automation generation.
The Copilot SDK and bundled CLI still provide the local agent runtime; Azure mode
does not require GitHub Copilot sign-in. The upstream source baseline is
`b05d59036182e897e1a60e90651e775cf5f97e8d` (`release/0.7.0`).

## Configure and use

1. Open **Skill Recorder Azure**, then **AI settings** on the recorder or Sessions window.
2. Choose **Azure OpenAI** and enter the resource endpoint and **deployment name**.
   A resource host such as `https://your-resource.openai.azure.com/` is normalized
   to `https://your-resource.openai.azure.com/openai/v1`.
3. Use **Responses** initially. The deployment must support image inputs and tool
   calling. A deployment name is not necessarily the underlying model name.
4. Enter your Azure OpenAI API key and choose **Save settings**. The app encrypts
   the saved key using Electron safeStorage (backed by macOS Keychain). The UI
   never reads the saved key back; a blank key field preserves the existing key.
5. Choose **Test saved connection**. This sends a synthetic image and a short
   conversation to Azure, checks image/tool support and a follow-up turn, and
   incurs model usage. No recordings are included.
6. Grant macOS Screen Recording permission to this app. Enable Accessibility or
   browser Automation access if macOS requests it for window/URL tracking. Relaunch
   after changing Screen Recording permission if required.
7. Record, Analyze, review/edit, and export a Skill. Choose the **Agent Skill**
   target for a generic `SKILL.md`; other targets retain their upstream catalogues.

Settings changes close idle AI conversations and invalidate prepared previews.
Saving/testing is rejected while recording or while an AI operation is active.
Live Azure recording analysis cannot be verified until a working key is entered.

Automation generation exports an agent-specific bundle; it does not create an
Azure scheduler or deploy an agent to Azure.

## Credentials and supported endpoints

- The initial implementation uses **API-key authentication over the Azure v1 API**.
  Entra ID login, managed identity, APIM/custom gateways, Foundry project endpoints,
  and dated deployment APIs are outside this version's scope.
- Azure OpenAI resource hosts in public, US Government, and China clouds pass URL
  validation. Availability of v1/model features in a given region/cloud still
  needs verification. HTTPS is required; URL credentials, query parameters,
  custom ports, and deployment-specific paths are rejected.
- The SDK receives the key via a per-request `bearerTokenProvider` callback,
  rather than a serialized `apiKey` field. Azure v1 accepts API keys as Bearer
  credentials. The local runtime uses its own `azure-runtime` directory, empty
  SDK mode, no inherited GitHub tokens, and disabled runtime logs.
- Runtime image capabilities are explicitly enabled for Azure deployments.
  Without this override, the pinned runtime can omit tool-result images even
  when the chosen deployment supports vision.
- The existing recording redaction and tool allowlists remain in place. Provider
  errors are replaced by safe messages rather than forwarding request details.
- Recording, extraction, and Whisper transcription remain local. Analysis and
  generation send their selected inputs to the configured provider. Runtime
  conversations can include recording data and are local app data, not encrypted
  recording storage. Delete recordings through the app when no longer needed.
- To remove a saved key, choose Copilot, select **Remove saved Azure key**, and
  save; or quit the app and delete `model-settings.json` in its user-data folder.

References: [Azure v1 API](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle),
[Azure v1 authentication](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/chat?view=rest-microsoft-foundry-v1),
[Copilot SDK BYOK](https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/byok).

## Develop and build

Use Node.js `24.19.0` or newer in the 24.x line, and npm `11.17.0` or newer:

```sh
npm ci
npm run compliance:licenses
npm run dev
```

For a source launch after `npm run build`, use `npm start`.
For an unsigned/ad-hoc signed local Mac ZIP, build natively on the target Mac:

```sh
npm run dist:portable:mac
```

If a synced working folder adds Finder metadata and macOS signing reports
`resource fork, Finder information, or similar detritus not allowed`, build to
an unsynced directory instead:

```sh
npm run dist:portable:mac -- --config.directories.output=/private/tmp/skill-recorder-azure-release
```

Packaging follows upstream's complete compliance preparation. This fork has a
distinct app name and ID so its settings are separate from the upstream app.
Signing/notarization for wider distribution is not configured.

## Environment configuration and evals

The UI is recommended for Finder launches. For headless evals or development,
set these environment variables **before** launching:

| Variable | Value |
| --- | --- |
| `SKILL_RECORDER_PROVIDER` | `azure` (or `copilot` to restore upstream authentication) |
| `AZURE_OPENAI_ENDPOINT` | Azure resource host or `/openai/v1/` endpoint |
| `AZURE_OPENAI_DEPLOYMENT` | Your deployed model's deployment name |
| `AZURE_OPENAI_API_KEY` | Key supplied securely in the process environment |
| `AZURE_OPENAI_WIRE_API` | `responses` (default) or `completions` |

Any of these variables selects environment configuration **as a whole**, overriding
saved settings without mixing credentials across resources. The settings UI becomes
read-only. Remove the variables and restart to return to saved settings. `.env`
files are not loaded automatically. Do not commit credentials or record setup.
`AZURE_OPENAI_API_VERSION` must be unset/empty because this integration uses v1.
`SKILL_RECORDER_MODEL` overrides only Copilot mode; Azure always uses its deployment.

```sh
npm run typecheck
npm run typecheck:evals
npm test
npm run build
# Require a working Azure environment configuration:
npm run eval
npm run eval:builder
npm run eval:skill
```

`electron/model-runtime.test.ts` runs the actual pinned CLI against a loopback
mock Responses API. It verifies the credential callback, image transfer, multiple
tool calls, follow-up conversation, and absence of plaintext keys in the live
runtime directory. It does not prove a real Azure deployment's quality or quota.
`model-integration.test.ts` checks routing for analysis, feedback, Skill preview
and export, and Automation generation. The saved-connection test in the app is
the next check after supplying real credentials.
