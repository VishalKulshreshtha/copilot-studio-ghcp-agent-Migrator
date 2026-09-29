---
name: "ghcp-agent-rearchitect"
description: "Find or clone a Copilot Studio agent, re-architect it, generate a GHCP scaffold, and install it into a target Copilot Studio agent."
---

Use this skill to find or clone a Copilot Studio standard-harness agent, analyze all downloaded components, re-architect it into a GHCP-harness design, optionally generate a new GHCP scaffold agent including generated skill scaffolds, and optionally install/push that scaffold into a target Copilot Studio cloud agent. This is not a solution-export flow. Do not ask for a Dataverse solution name unless the user explicitly requests PAC/solution export.

Important limitation:
- The installed skills-for-copilot-studio manage-agent bundle supports auth, push, pull, clone, changes, validate, publish, list-agents, and list-envs.
- It does not expose a direct create-new-cloud-agent command.
- The Copilot Studio `/build` natural-language builder has a visible chat composer ("Describe what you want to do") and file attachment support. This skill may use that builder only when the user explicitly chooses the NLA Builder path. Do not silently use browser automation when the user requested API-only automation.
- API-based NLA create remains preferred for unattended automation when a supported or explicitly configured NLA-create endpoint is available. If no API endpoint is available, ask the user whether to use the NLA Builder UI path or install into an existing target agent.
- If no create API is available, the supported path remains: user provides a blank/template target agent that already exists in Copilot Studio, then this skill clones that target agent, installs the generated GHCP scaffold into it, validates, and pushes after explicit confirmation.

Preferred input:
- Copilot Studio source agent display name or URL, OR
- local cloned source agent folder, OR
- existing agent.ir.json, OR
- existing agent.target.ir.json for direct generation.

Optional cloud output input:
- Target blank/template Copilot Studio agent URL or display name where the generated GHCP scaffold should be pushed.

Goal:
- Download/locate the source Copilot Studio agent using skills-for-copilot-studio manage-agent flow.
- Generate or read agent.ir.json.
- Produce agent.target.ir.json and ghcp-rearchitecture-plan.md.
- Include a GHCP skill generation plan when the new agent needs skills.
- Generate a new local GHCP scaffold folder from agent.target.ir.json, including skills/*/SKILL.md where needed.
- Generate an NLA build prompt (`nla-build-prompt.md`) that can be pasted into the Copilot Studio home page "what do you want to build?" box to let Copilot Studio create a new GHCP/NLA Agent from the standard-agent summary and exact process design.
- If requested, install that scaffold into a cloned target Copilot Studio agent workspace, validate, and push after explicit confirmation.

Use these installed resources:
- agency-copilot-studio-int-project-context for Copilot Studio project structure.
- agency-copilot-studio-int-reference for file types, trigger/action kinds, variables, connector actions, and Power Fx constraints.
- agency-copilot-studio-int-patterns for recommended design patterns.
- manage-agent bundle: discover from the installed `skills-for-copilot-studio` plugin, normally `%USERPROFILE%\.copilot\installed-plugins\skills-for-copilot-studio\copilot-studio\scripts\manage-agent.bundle.js`; if missing, ask the user to install the Copilot Studio VS Code extension / skills-for-copilot-studio package first.
- bundled analyzer/generator/install CLI: `${CLAUDE_SKILL_DIR}\tools\ghcp-agent-migrator\bin\ghcp-agent-migrator.mjs`. Always use this bundled CLI from the installed skill folder, not a machine-specific path.

Prerequisite handling:
- Before clone/push/generate operations, check Node.js 20+, npm, the bundled migrator dependencies, Copilot Studio VS Code extension, and the `skills-for-copilot-studio` manage-agent bundle.
- If Node/npm are missing, give install commands (`winget install OpenJS.NodeJS.LTS`) and stop.
- If migrator dependencies are missing, run `npm install` in `${CLAUDE_SKILL_DIR}\tools\ghcp-agent-migrator`.
- If Copilot Studio VS Code extension is missing and the `code` CLI exists, offer to install `ms-copilotstudio.vscode-copilotstudio`; otherwise provide manual install instructions.
- If manage-agent.bundle.js is missing, stop and tell the user to install/configure `skills-for-copilot-studio`; do not attempt clone/push without it.

Workflow:
1. Source acquisition:
   - Prefer asking the user for the Copilot Studio source agent URL first. The URL carries environmentId and agentId and avoids tenant/environment ambiguity.
   - Ask for the Copilot Studio URL and tenant ID/domain up front when they are not already known. Accept tenant GUID or tenant domain (for example `contoso.onmicrosoft.com`); if a domain is provided, resolve it to the tenant GUID before calling the LSP because some LSP calls require a GUID.
   - Use the current signed-in Power Platform/Copilot Studio account from the user/browser/session. Do not force a hard-coded tenant, `common`, or Microsoft corporate tenant login. Before interactive auth, tell the user which account/tenant should be selected.
   - If sign-in prompts show "selected user account does not exist in tenant", ask the user to choose the account that owns the provided Copilot Studio environment or use "Use another account"; do not continue with the wrong account.
   - When a URL is provided, parse `environmentId` and `agentId` from `/environments/<environmentId>/bots/<agentId>` or `/environments/<environmentId>/agents/<agentId>` and run manage-agent with `--url`, `--tenant-id <tenantGuidOrDomain>`, and `--account-email <currentPowerPlatformAccount>` when known.
   - If the user provides agent.ir.json, read it and proceed to re-architecture.
   - If the user provides a local source agent folder, confirm it contains agent.mcs.yml and run analyze.
   - If the user provides a Copilot Studio source URL, clone it with manage-agent clone --url.
   - If the user provides only a source agent name, use manage-agent list-envs/list-agents, ask for environment if needed, match the display name, and clone the selected source agent.
2. Analyze source:
   - Run: node .\bin\ghcp-agent-migrator.mjs analyze "<source-agent-folder>" --out "<workdir>\agent.ir.json"
   - Read agent.ir.json.
   - Ensure `agent.ir.json` contains a full `sourceDossier` covering identity/settings/auth/channels, original instructions, conversation starters, every topic trigger and process step including nested branches, action/tool connector details and bindings, knowledge sources, variables/state, child agents, connection references, fallback/error/sign-in/reset behavior, and migration warnings.
   - Ensure `sourceDossier.resourceInventory` exists and captures first-hand exported resource details:
     - Dataverse table names from connector bindings such as `entityName`
     - Dataverse organization/environment URLs from connector bindings such as `organization`
     - connection reference logical names and connector IDs from `connectionreferences.mcs.yml`
     - SharePoint/site/file URLs from knowledge source YAML
     - which topic/action/step uses each connection/table/source
   - If resourceInventory has `missingResourceDetails`, report those exact gaps and ask only for missing opaque values; do not ask for URLs/table names that were already discovered from export.
3. Rearchitect:
   - Analyze topics, routing, actions/tools, knowledge, variables/state, child-agent opportunities, fallback/error handling, Teams/M365 hardening, skills needed, and migration risks.
   - Write <workdir>\agent.target.ir.json with source references, migration decisions, explicit skills when needed, and the full `sourceDossier` including `resourceInventory` from agent.ir.json so NLA generation has enough exact source/resource detail to recreate behavior without copying standard topic structure.
   - Write <workdir>\ghcp-rearchitecture-plan.md with executive summary, current-state findings, proposed GHCP style, topic/action/knowledge/variable redesign, GHCP skill generation plan, recommended patterns, risks, and generation readiness checklist.
4. Generate local GHCP scaffold:
   - Ask whether to generate the scaffold if not already explicitly requested.
   - Run: node .\bin\ghcp-agent-migrator.mjs generate --target-ir "<workdir>\agent.target.ir.json" --out "<workdir>\ghcp-agent"
   - Report generated files including agent.mcs.yml, instructions.md, nla-build-prompt.md, nla-build-prompt.short.md, settings.mcs.yml, behaviors/*/skill.mcs.yml, behaviors/*/SKILL.md, action-designs.json, knowledge-designs.json, skills/*/SKILL.md, skills-manifest.json, ghcp-implementation-manifest.json, and generation-report.json.
   - Verify `nla-build-prompt.md` includes a "Full source-agent dossier" section before using the NLA API path. If missing, regenerate analysis and merge `sourceDossier` into target IR.
   - Verify generated prompts and `ghcp-implementation-manifest.json` include discovered Dataverse tables, organization URLs, connector references, and SharePoint/knowledge URLs from `sourceDossier.resourceInventory`.
   - Verify `nla-build-prompt.short.md` is under 8000 characters and preserves the goal, exact process, skills, tools/actions, knowledge, routing, and guardrails. Use the short prompt when the NLA API has an 8K prompt limit.
   - The NLA prompts must be business-facing creation prompts. Do not include phrases like "standard agent", "old topic tree", "migration", "source agent", "rearchitecture", or "do not recreate" in the prompt text shown to Copilot Studio. Use source details only as positive business requirements, process steps, skills, tools, knowledge, and guardrails.
   - Use `ghcp-implementation-manifest.json` as the checklist for what must be installed/pushed into an existing GHCP target.
   - IMPORTANT: GHCP output must be instructions/skills/tools/knowledge design-first. Do not generate or install standard-harness topic YAML as the primary migration shape. Standard `topics/*.mcs.yml` and `variables/*.mcs.yml` scaffolds are intentionally not part of GHCP-native generation unless a later explicit implementation step creates validated GHCP-compatible components.
5. Ask the user how to create/update the GHCP agent:
   - Present three choices with `m_ask_user`:
     1. **NLA Builder** — use Copilot Studio `/build` to create the agent from `nla-build-prompt.short.md` and attached design artifacts.
     2. **API create** — call a configured NLA create-agent API endpoint.
     3. **Install into target** — install/push the generated GHCP scaffold into an existing target agent.
   - Recommend **NLA Builder** when the user wants Copilot Studio to generate visible Instructions, Skills, Tools, and Knowledge from the prompt.
   - Recommend **Install into target** when the target GHCP agent already exists and the user wants deterministic file-based update.
   - Recommend **API create** only when a supported/configured NLA create endpoint is available.
6. Create a new GHCP/NLA cloud agent through an API call, only if requested:
   - Use this path when the user wants Copilot Studio itself to generate the new GHCP/NLA agent instead of pushing into an existing blank/template target.
   - Generate or reuse <workdir>\ghcp-agent\nla-build-prompt.md and <workdir>\ghcp-agent\nla-build-prompt.short.md.
   - Ask for explicit confirmation before creating a new cloud agent because this creates tenant-visible Copilot Studio content and may consume Copilot credits.
   - Do NOT use browser UI automation for this path.
   - First look for a known/configured NLA create endpoint in environment/configuration:
     - `CPS_NLA_CREATE_AGENT_URL`
     - `CPS_NLA_CREATE_AGENT_METHOD` (default `POST`)
     - `CPS_NLA_CREATE_AGENT_SCOPE` (default to the Copilot Studio/Island API scope used by manage-agent if applicable)
   - If no endpoint is configured, inspect only local installed scripts/docs for an existing supported create command. Do not guess undocumented endpoints.
   - If an endpoint is available, acquire or provide the appropriate token for that endpoint, then run:
     `node .\bin\ghcp-agent-migrator.mjs nla-create --prompt "<workdir>\ghcp-agent\nla-build-prompt.short.md" --environment-id "<environmentId>" --display-name "<targetAgentName>" --endpoint "<nlaCreateUrl>" --access-token "<token>" --out "<workdir>\ghcp-agent\nla-api-create-result.json"`
   - The `nla-create` command sends a JSON payload containing:
     - environmentId
     - displayName
     - prompt: full contents of `nla-build-prompt.md`
     - buildType: `Agent`
     - source: `ghcp-agent-rearchitect`
     - sourceTargetIr: path or embedded summary from `agent.target.ir.json`
   - Save the API request/response metadata, excluding secrets/tokens, to `<workdir>\ghcp-agent\nla-api-create-result.json`.
   - If the API returns an operation id, poll the operation status endpoint only if it is provided by the API response; do not invent a polling URL.
   - Capture the created agent id, display name, and URL from the API response.
   - After creation, use manage-agent list-agents/clone where possible to inspect the generated draft agent and compare against `agent.target.ir.json`, `skills-manifest.json`, `action-designs.json`, and `knowledge-designs.json`.
   - If the API endpoint is unavailable, unsupported, or undocumented, stop and report that a supported NLA create-agent API endpoint is required. Do not switch to browser automation unless the user explicitly changes the requirement.
7. Create through Copilot Studio NLA Builder UI, only when the user explicitly chooses **NLA Builder**:
   - Derive `<environmentId>` dynamically from the source/target URL or selected environment, then navigate to `https://copilotstudio.preview.microsoft.com/environments/<environmentId>/build`. Never hard-code an environment id.
   - If sign-in, environment selection, or consent appears, pause and ask the user to complete it in the browser.
   - Use the accessible chat input labeled "Copilot Chat" / "Describe what you want to do".
   - Prefer attaching the generated files when the UI accepts them:
     - `<workdir>\ghcp-agent\nla-build-prompt.short.md`
     - `<workdir>\ghcp-agent\ghcp-implementation-manifest.json`
     - `<workdir>\ghcp-agent\skills\skills-manifest.json`
     - `<workdir>\ghcp-agent\actions\action-designs.json`
     - `<workdir>\ghcp-agent\knowledge\knowledge-designs.json`
   - If file attachment is not accepted, paste the full contents of `nla-build-prompt.short.md` into the chat input.
   - Before submitting, show the user the agent name, environment, and prompt file path, then ask for confirmation because this may create tenant-visible content and consume credits.
   - Submit the prompt only after explicit confirmation.
   - Wait for the builder to finish; capture the created/updated agent URL, artifacts, and any errors.
   - Inspect the generated agent. If the builder omitted critical skills/tools/knowledge, use the generated local files to refine the agent, or report the exact missing surfaces.
   - Do not publish automatically.
8. Install into Copilot Studio target agent, only if requested:
   - Explain that a blank/template target agent must already exist in Copilot Studio because manage-agent has no create command.
   - Ask for target agent URL or display name.
   - Clone the target agent to <workdir>\target-agent using manage-agent clone. If only target display name is provided, list environments/agents and select it.
   - Run: node .\bin\ghcp-agent-migrator.mjs install --source "<workdir>\ghcp-agent" --target "<workdir>\target-agent" --clean
   - The installer must merge instructions.md into the target GHCP `settings.mcs.yml` under `configuration.agentSettings.instructions.segments`, and must also patch `.mcs\botdefinition.json` at `entity.configuration.agentSettings.instructions.segments[0].value`. Settings YAML can validate while the UI still shows blank instructions unless botdefinition carries the value.
   - Ensure `ghcp-implementation-manifest.json`, `action-designs.json`, `knowledge-designs.json`, and `skills/*/SKILL.md` are present locally before pushing; these are the necessary implementation artifacts used to complete/refine the GHCP agent after push.
   - The generated GHCP behavior skills must follow the Copilot Studio GHCP harness shape: `behaviors/<skill-name>/skill.mcs.yml` with `kind: InlineAgentSkill` plus sibling `SKILL.md`. Validate should show "packaged skill payload files added".
   - Tools must follow the GHCP shape when a backing workflow exists: `capabilities/tools/*.mcs.yml` with `kind: WorkflowTool`, plus corresponding `actions/*.action.mcs.yml` TaskDialog and workflow assets. If no backing workflow/tool endpoint exists, keep the tool as an action design and report it as not yet visible in the Build UI.
   - Knowledge creation still requires a supported GHCP knowledge file/API shape; if unavailable, keep `knowledge-designs.json` and report the knowledge surface as design-only.
   - Validate the target workspace with manage-agent validate using the target workspace connection values.
   - If validation errors exist, fix them if feasible or report blockers.
   - Before push, show that push will overwrite/update the target cloud agent and ask for explicit confirmation.
   - Run manage-agent push only after confirmation.
   - After push, run manage-agent changes and inspect/clone the target `.mcs\botdefinition.json`. A completed GHCP skills implementation should include `GptComponent` skill components (or equivalent) in addition to `BotSettingsComponent`. If the bot definition only contains `BotSettingsComponent`, report the target is still a plain GHCP agent.
   - Publish only after separate explicit confirmation.

Decision rules:
- Start from agent name or Copilot Studio URL whenever possible.
- Do not ask for source solution name in the normal flow.
- Do not claim a brand-new cloud agent was created unless a target cloud agent was provided and push succeeded.
- Prefer semantic re-architecture over one-to-one copying.
- For GHCP targets, convert standard topics into instruction/skill/tool/knowledge design entries first; do not recreate the old standard topic structure in the target agent.
- Preserve simple focused topics only as design intent unless the user separately asks for validated component implementation.
- Split broad topics with unrelated branches or excessive steps into skills/tool designs and routing instructions.
- Recommend deterministic tool wrappers or generated skill scaffolds for business-critical connector/tool calls.
- Recommend explicit skills entries in target IR for reusable capabilities in the new GHCP agent.
- When the user references the Copilot Studio `/build` or NLA builder screen, offer the explicit NLA Builder path. Use API-only creation only when the user requests API automation or a supported endpoint is configured.
- Present `behaviors/*/skill.mcs.yml` as visible GHCP skill components only after validation/push confirms they are packaged and represented in the target bot definition. Local `skills/*/SKILL.md`, `action-designs.json`, or `knowledge-designs.json` remain design inputs unless backed by valid GHCP component YAML/API creation.
- Never say the GHCP agent is complete if Copilot Studio still shows empty/default Instructions, Skills, Tools, or Knowledge. Verify the visible surfaces or report the exact blocker.
- Clearly distinguish generated local scaffold from cloud Copilot Studio agent.
- Treat exported source files and IR as private customer data.
- Do not push or publish changes unless explicitly requested and confirmed.
- Do not claim migration is complete until target IR, plan, scaffold, skill scaffolds, cloud install/push if requested, and requested validation are complete.
