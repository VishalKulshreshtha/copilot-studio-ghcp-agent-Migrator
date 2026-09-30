---
name: "ghcp-agent-migrator"
description: "Migrate and rearchitect Copilot Studio Standard harness agents into GitHub Copilot / GHCP harness agents. Supports Code local CLI mode and Cowork-safe artifact/NLA mode."
metadata:
  version: "0.2.0"
---

# GHCP Agent Migrator for Copilot Code / Cowork

Use this skill to migrate and rearchitect a Copilot Studio **Standard harness** agent into a **GitHub Copilot / GHCP harness** agent design and scaffold.

Recommended user prompt:

```text
/ghcp-agent-migrator <Copilot Studio source agent URL>
```

The user should not need to paste CLI commands, MCP instructions, token guidance, or Builder API details. Those details are part of this skill and must be handled internally.

This package supports two runtime modes:

1. **Code local mode** — full workflow, like Microsoft Scout, when local shell/filesystem access is available.
2. **Cowork-safe mode** — prompt/artifact workflow only, when local CLI/file tools are unavailable.

Do **not** look for a separate GHCP Agent Migrator MCP server or extension. This package is a skill plus a bundled CLI helper. In Code local mode, use shell commands to run the bundled CLI and the external Copilot Studio `manage-agent.bundle.js`.

## Runtime detection

At the start of a task, determine the available runtime:

### Code local mode

Use Code local mode when the host can run shell commands and read/write local files. In this mode, this skill **must use the bundled CLI directly**:

```text
${CLAUDE_SKILL_DIR}\tools\ghcp-agent-migrator\bin\ghcp-agent-migrator.mjs
```

Code local mode can:

- install npm dependencies for the bundled CLI if missing
- clone/pull/push Copilot Studio agents using `manage-agent.bundle.js`
- analyze a cloned/exported Standard harness agent
- generate `agent.ir.json`
- generate `agent.target.ir.json`
- generate GHCP scaffold files
- generate NLA prompts
- install scaffold files into an existing GHCP target workspace
- validate and push after explicit user confirmation

Important:

- Do not call `extensions_manage`.
- Do not report "no MCP tools/extensions" as a blocker in Code local mode.
- The correct check is whether the shell can run:

  ```powershell
  node "${CLAUDE_SKILL_DIR}\tools\ghcp-agent-migrator\bin\ghcp-agent-migrator.mjs" --help
  ```

- Then check for `manage-agent.bundle.js` at the normal installed plugin path, or ask the user for its path:

  ```text
  %USERPROFILE%\.copilot\installed-plugins\skills-for-copilot-studio\copilot-studio\scripts\manage-agent.bundle.js
  ```

- If `manage-agent.bundle.js` exists, use it to clone/pull/push Copilot Studio agents. Do not ask the user to manually export before trying this.

### Cowork-safe mode

Use Cowork-safe mode when shell/filesystem/local CLI access is unavailable.

Cowork-safe mode can:

- read attached `agent.ir.json`, `agent.target.ir.json`, `nla-build-prompt.short.md`, or manifest files
- use Copilot Studio `/build` NLA Builder when explicitly approved
- derive and call the NLA Builder API endpoint from the selected environment id
- commit a Builder `build` event into Dataverse when the user explicitly confirms and provides/derives a Dataverse token
- explain which full extraction/install steps need Code local or Scout/CLI

Cowork-safe mode cannot:

- run the bundled CLI
- install npm dependencies
- run `manage-agent.bundle.js`
- clone/pull/push Copilot Studio agents
- validate through the Copilot Studio LSP
- patch `.mcs\botdefinition.json`

If a task requires live source extraction or target install/push and the runtime is Cowork-safe, do not fail with “missing MCP tools.” Instead, explain that the user must switch to Code local/Scout/CLI mode or provide pre-generated artifacts.

If a task is running in Code local mode and shell commands are available, do not switch to Cowork-safe mode just because MCP tools are unavailable.

## Prerequisites for Code local mode

Check these before running full extraction/install:

- Node.js 20+
- npm
- Copilot Studio VS Code extension
- `skills-for-copilot-studio` manage-agent bundle, normally:

```text
%USERPROFILE%\.copilot\installed-plugins\skills-for-copilot-studio\copilot-studio\scripts\manage-agent.bundle.js
```

If Node.js is missing, suggest:

```powershell
winget install OpenJS.NodeJS.LTS
```

If CLI dependencies are missing, run from the bundled CLI folder:

```powershell
npm install
```

If `manage-agent.bundle.js` is missing, ask the user to install/configure the Copilot Studio VS Code extension / `skills-for-copilot-studio` package.

## Preferred input

Prefer a Copilot Studio source agent URL:

```text
https://copilotstudio.preview.microsoft.com/environments/<environmentId>/agents/<agentId>
```

or:

```text
https://copilotstudio.preview.microsoft.com/environments/<environmentId>/bots/<botId>/overview
```

Also ask for tenant ID/domain when not known. Accept a tenant GUID or a tenant domain such as:

```text
contoso.onmicrosoft.com
```

Use the current signed-in Power Platform/Copilot Studio account. Do not force a hard-coded tenant or `common`. If Microsoft sign-in says the selected user does not exist in the tenant, ask the user to choose the account that owns the provided environment or use **Use another account**.

## Code local mode workflow

Do this in strict order. Never start creating the new GHCP/NLA agent until the existing Standard harness agent has been exported/cloned and analyzed.

1. Ask for the source Copilot Studio agent URL and tenant ID/domain if missing.
2. Parse `environmentId` and `agentId` from the URL.
3. Check local prerequisites with shell:

   ```powershell
   node --version
   npm --version
   node "${CLAUDE_SKILL_DIR}\tools\ghcp-agent-migrator\bin\ghcp-agent-migrator.mjs" --help
   ```

4. If bundled CLI dependencies are missing, run:

   ```powershell
   cd "${CLAUDE_SKILL_DIR}\tools\ghcp-agent-migrator"
   npm install
   ```

5. Locate `manage-agent.bundle.js`. First try:

   ```text
   %USERPROFILE%\.copilot\installed-plugins\skills-for-copilot-studio\copilot-studio\scripts\manage-agent.bundle.js
   ```

   If missing, ask the user to provide the path or install `skills-for-copilot-studio`.

6. Clone the source agent using `manage-agent.bundle.js clone --url`.
7. Analyze the cloned Standard harness agent:

   ```powershell
   node .\bin\ghcp-agent-migrator.mjs analyze "<source-agent-folder>" --out "<workdir>\agent.ir.json"
   ```

8. Ensure `agent.ir.json` includes:
   - identity/settings/auth/channels
   - original instructions and conversation starters
   - topic triggers and nested process steps
   - action/tool bindings
   - Dataverse table names and org URLs
   - connection reference logical names and connector IDs
   - SharePoint/knowledge URLs
   - variables/state
   - child agents
   - fallback/error/sign-in/reset behavior

9. Produce `agent.target.ir.json` and `ghcp-rearchitecture-plan.md`.
10. Generate the GHCP scaffold:

   ```powershell
   node .\bin\ghcp-agent-migrator.mjs generate --target-ir "<workdir>\agent.target.ir.json" --out "<workdir>\ghcp-agent"
   ```

11. Ask the user how to proceed:
   - **NLA Builder** — use Copilot Studio `/build`.
   - **API create** — call configured NLA create endpoint.
   - **Install into target** — install/push into existing GHCP target agent.

If source clone/analyze fails, stop and report the blocker. Do not create the new GHCP agent from guesses or partial source details.

## Generated outputs

The generated `ghcp-agent` folder should include:

```text
instructions.md
nla-build-prompt.md
nla-build-prompt.short.md
settings.mcs.yml
behaviors/<skill>/skill.mcs.yml
behaviors/<skill>/SKILL.md
actions/action-designs.json
knowledge/knowledge-designs.json
skills/skills-manifest.json
ghcp-implementation-manifest.json
generation-report.json
```

The NLA prompts must be business-facing. Do not include phrases like:

- standard agent
- old topic tree
- migration
- source agent
- rearchitecture
- do not recreate

Use source details only as positive requirements, process steps, skills, tools, knowledge, and guardrails.

## NLA Builder mode

Use this when the user wants Copilot Studio to create the new GHCP/NLA agent.

Before using Builder, verify one of these is true:

- Code local mode already produced `agent.ir.json`, `agent.target.ir.json`, and `nla-build-prompt.short.md`, or
- the user attached equivalent pre-generated artifacts.

If not, stop and request/export the source agent first.

1. Derive `<environmentId>` from source/target URL or selected environment.
2. Navigate to:

   ```text
   https://copilotstudio.preview.microsoft.com/environments/<environmentId>/build
   ```

3. Use the chat input labeled **Copilot Chat** / **Describe what you want to do**.
4. Prefer attaching:
   - `nla-build-prompt.short.md`
   - `ghcp-implementation-manifest.json`
   - `skills/skills-manifest.json`
   - `actions/action-designs.json`
   - `knowledge/knowledge-designs.json`
5. If attachments are unavailable, paste `nla-build-prompt.short.md`.
6. Ask for explicit confirmation before submitting because it may create tenant-visible content and consume credits.
7. Capture the created agent URL and generated artifacts.
8. Do not publish automatically.

## API create mode

Use this mode when the runtime can make authenticated Power Platform HTTP calls. The skill must manage the Builder endpoint itself. Do **not** ask the user to provide an API URL.

### Builder endpoint generation

For whatever environment is being used, build the Builder URL at runtime:

1. Parse `environmentId` from the Copilot Studio URL or ask only for the environment id if no URL was supplied.
2. Remove hyphens and lowercase it:

   ```text
   normalizedEnvironmentId = lower(removeHyphens(environmentId))
   ```

3. Preferred: resolve the environment API endpoint from Power Platform environment metadata:

   ```text
   GET https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/environments/<environmentId>?api-version=2023-06-01&$expand=properties.runtimeEndpoints
   ```

4. Read the relevant environment API endpoint from `properties.runtimeEndpoints` when available. Select the endpoint whose host ends with:

   ```text
   environment.api.powerplatform.com
   ```

   The endpoint should look like:

   ```text
   https://<environment-specific-host>.environment.api.powerplatform.com
   ```

5. Fallback when metadata is unavailable but the environment id is known: construct the observed host pattern by splitting the 32-character normalized environment id into the first 30 characters and final 2 characters:

   ```text
   environmentApiEndpoint = https://<normalizedEnvironmentId[0..29]>.<normalizedEnvironmentId[30..31]>.environment.api.powerplatform.com
   ```

   Example:

   ```text
   environmentId = 11111111-2222-3333-4444-5555555555aa
   normalizedEnvironmentId = 111111112222333344445555555555aa
   environmentApiEndpoint = https://111111112222333344445555555555.aa.environment.api.powerplatform.com
   ```

6. Build the final Builder URL:

   ```text
   <environmentApiEndpoint>/copilotflows/agenticbuilder/build?api-version=2024-10-01
   ```

7. Acquire tokens from the current Power Platform/Copilot Studio user session. If using the `skills-for-copilot-studio` shared auth helper, acquire:

   ```text
   https://service.powerapps.com/.default
   https://api.powerplatform.com/.default
   ```

   Use the Power Platform API token for the `agenticbuilder/build` call. Do not commit or print access tokens. If temporary token files are used, keep them local-only and delete them at the end.

If endpoint derivation fails, report the exact environment/auth problem. Do not ask the user for a generic API URL unless they explicitly choose a custom/nonstandard endpoint override.

Send:

```json
{
  "message": "<prompt>",
  "artifactMode": {
    "type": "multiple",
    "artifactTypesEnabled": {
      "flow": true,
      "agent": true,
      "skill": true
    }
  },
  "timeZoneId": "<user time zone>"
}
```

If the Builder response requests connections, continue the same conversation id rather than starting over:

```json
{
  "conversationId": "<conversationId from first response>",
  "confirmPlan": true,
  "connections": [
    {
      "connectorId": "shared_commondataserviceforapps",
      "connectionName": "<connection name>",
      "id": "/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps/connections/<connection name>",
      "status": "Connected",
      "connection_result": {
        "connectorId": "shared_commondataserviceforapps",
        "connectionName": "<connection name>",
        "id": "/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps/connections/<connection name>",
        "status": "Connected"
      }
    }
  ],
  "artifactMode": {
    "type": "multiple",
    "artifactTypesEnabled": {
      "flow": true,
      "agent": true,
      "skill": true
    }
  },
  "timeZoneId": "<user time zone>"
}
```

If the API returns `connection` events, surface the needed connector names to the user and ask them to select/confirm existing connections. Do not fabricate connection names or connection reference logical names.

### Direct Dataverse creation from Builder output

When the Builder stream emits a `build` event, save the stream to a local file. If the user already approved cloud creation, or after asking for explicit confirmation, commit the generated definitions through Dataverse. This is the Cowork/Builder continuation path that creates the bot directly from the Builder output:

```powershell
node "${CLAUDE_SKILL_DIR}\tools\ghcp-agent-migrator\bin\ghcp-agent-migrator.mjs" commit-builder-response --response "<builder-response.json>" --dataverse-url "<dataverseUrl>" --access-token "<dataverseAccessToken>" --display-name "<agentName>" --out "<created-agent.json>"
```

When running from the full GitHub repository rather than inside the skill folder, this equivalent script may be used:

```powershell
node .\scripts\create-agent-in-dataverse.cjs --response "<builder-response.json>" --dataverse-url "<dataverseUrl>" --access-token "<dataverseAccessToken>" --display-name "<agentName>" --out "<created-agent.json>"
```

The skill must derive or discover `<dataverseUrl>` from the selected environment whenever possible. Prefer `properties.linkedEnvironmentMetadata.instanceUrl` from the same BAP environment metadata response. If unavailable, use the source resource inventory org URL only when it belongs to the selected environment.

Use a Dataverse token for the target org URL. Do not print, log, commit, or package tokens.

The direct Dataverse creation path creates:

- one `bots` row for the generated GHCP agent
- `botcomponents` rows for generated behavior skills
- `botcomponents` rows for generated connector tools
- `botcomponents` rows for generated knowledge source configurations

Expected Dataverse endpoints:

```text
POST <dataverseUrl>/api/data/v9.2/bots
POST <dataverseUrl>/api/data/v9.2/botcomponents
```

Bot payload fields must come from the Builder `build` event and generated target design, not from hard-coded tenant/user/sample values:

```text
name
schemaname
template
language
authenticationmode
authenticationtrigger
accesscontrolpolicy
runtimeprovider
componentstate
configuration
```

Component payload fields:

```text
name
schemaname
componenttype
data
description
language
componentstate
parentbotid@odata.bind
```

Use `componenttype: 9` for `InlineAgentSkill` and connector tool components. Use `componenttype: 16` for `KnowledgeSourceConfiguration` components.

Do not guess undocumented endpoints.

## Install into target mode

Use this when a blank/template GHCP target agent already exists.

1. Clone the target agent.
2. Run:

   ```powershell
   node .\bin\ghcp-agent-migrator.mjs install --source "<workdir>\ghcp-agent" --target "<target-agent-workspace>" --clean
   ```

3. Validate with `manage-agent.bundle.js validate`.
4. Push only after explicit confirmation.
5. Do not publish automatically.

Generated GHCP behavior skills should follow this harness shape:

```text
behaviors/<skill-name>/skill.mcs.yml   kind: InlineAgentSkill
behaviors/<skill-name>/SKILL.md
```

Tools should use valid GHCP tool/workflow assets when backing workflow IDs exist. Otherwise keep them as design requirements.

## Output/reporting

Always state:

- runtime mode used
- whether agent was created/updated
- generated artifacts
- missing tools/knowledge, if any
- whether publish was skipped

Never claim the GHCP agent is complete if Copilot Studio still shows empty/default Instructions, Skills, Tools, or Knowledge.

## Disclaimer

This is a sample skill. It is not an official Microsoft migration product and provides no warranty, guarantee, SLA, or official support. Users must review generated agents before publishing.
