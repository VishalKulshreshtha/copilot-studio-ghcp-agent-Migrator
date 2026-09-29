# GHCP Agent Rearchitect Skill for Copilot Studio

> Sample/community skill. This package is provided as-is, with no warranty, guarantee, or official Microsoft support. Review, test, and adapt it for your own tenant, security requirements, and deployment process before use.

## Why this skill exists

Copilot Studio agents built with the older **standard harness** do not have a direct one-click migration path to the newer **GitHub Copilot / GHCP-style agent authoring experience**.

This skill helps by **re-architecting** a standard Copilot Studio agent into a GHCP-style design:

- Extracts the source agent structure, process, topics, actions, knowledge, child agents, connector references, Dataverse table usage, SharePoint URLs, and settings.
- Produces an intermediate `agent.ir.json` and GHCP target design.
- Generates business-facing NLA builder prompts.
- Generates GHCP-compatible skill scaffolds using the `behaviors/<skill>/skill.mcs.yml` + `SKILL.md` pattern.
- Can install generated GHCP artifacts into an existing GHCP target agent and push through `manage-agent`.
- Can use Copilot Studio `/build` NLA Builder mode when the user explicitly chooses it.

This is **not an automatic migration guarantee**. It is a rearchitecture assistant that creates a reviewable GHCP design and implementation scaffold.

## Input and output

**Input: Standard harness Copilot Studio agent**

The input is an existing Copilot Studio agent built with the standard harness, such as an agent that contains:

- Overview instructions
- Knowledge sources
- Tools/actions
- Topics
- Connected agents
- Triggers
- Dataverse/SharePoint connection references

**Output: GitHub harness / GHCP agent**

The output is a new or updated GHCP-style agent that represents the same business logic using:

- GHCP/NLA instructions
- GHCP behavior skills
- Deterministic tool design or workflow-backed tools
- Knowledge source design/connection details
- A generated NLA Builder prompt for Copilot Studio `/build`
- A generated scaffold that can be installed into an existing GHCP harness agent

In other words:

```text
Standard harness agent  -->  GHCP / GitHub harness agent
```

## Example

### Input: Standard harness agent

The source standard harness agent may include classic overview instructions, topics, knowledge, tools, triggers, and connected agents.

![Standard harness agent overview](docs/images/standard-harness-agent.png)

### Output: GitHub harness / GHCP agent

The target GHCP agent should be represented through instructions, skills, tools, and knowledge in the GitHub harness authoring experience.

![GHCP harness agent overview](docs/images/ghcp-harness-agent.png)

## Package contents

```text
ghcp-agent-rearchitect/
  SKILL.md
  tools/
    ghcp-agent-migrator/
      bin/ghcp-agent-migrator.mjs
      package.json
      package-lock.json
install.ps1
README.md
```

## Prerequisites

Each user/machine needs:

1. **Microsoft Scout** with custom skills enabled.
2. **Node.js 20+** available on PATH.
3. **Copilot Studio VS Code extension** installed.
4. **skills-for-copilot-studio manage-agent bundle** available locally, typically at:

   ```text
   %USERPROFILE%\.copilot\installed-plugins\skills-for-copilot-studio\copilot-studio\scripts\manage-agent.bundle.js
   ```

5. Access to the target Power Platform environment and Copilot Studio agents.
6. Permission to clone/push Copilot Studio agents using the same tenant/account.
7. Optional: an existing blank/template GHCP agent when using the “install into target” path.

### Installing prerequisites

Install Node.js 20+:

```powershell
winget install OpenJS.NodeJS.LTS
```

Or download from:

```text
https://nodejs.org/
```

Install the Copilot Studio VS Code extension:

```powershell
code --install-extension ms-copilotstudio.vscode-copilotstudio
```

If `code` is not available on PATH, install it from Visual Studio Code command palette:

```text
Shell Command: Install 'code' command in PATH
```

The `skills-for-copilot-studio` manage-agent bundle is required for clone/validate/push operations. If it is missing, install or clone the `skills-for-copilot-studio` package so this file exists:

```text
%USERPROFILE%\.copilot\installed-plugins\skills-for-copilot-studio\copilot-studio\scripts\manage-agent.bundle.js
```

The installer checks for Node.js, npm, the Copilot Studio VS Code extension, and the manage-agent bundle. It can attempt to install the VS Code extension automatically when `code` is available:

```powershell
.\install.ps1 -InstallCopilotStudioExtension
```

## Install

From the package root:

```powershell
.\install.ps1
```

This copies `ghcp-agent-rearchitect` to:

```text
%USERPROFILE%\.scout\m-skills\ghcp-agent-rearchitect
```

and runs `npm install` inside the bundled migrator tool.

To also try installing the Copilot Studio VS Code extension automatically:

```powershell
.\install.ps1 -InstallCopilotStudioExtension
```

If you prefer manual install:

```powershell
Copy-Item -Recurse .\ghcp-agent-rearchitect "$env:USERPROFILE\.scout\m-skills\ghcp-agent-rearchitect" -Force
cd "$env:USERPROFILE\.scout\m-skills\ghcp-agent-rearchitect\tools\ghcp-agent-migrator"
npm install
```

Restart or reload Microsoft Scout after installation.

## How to use

In Scout:

```text
/ghcp-agent-rearchitect <source agent name or Copilot Studio URL>
```

Example:

```text
/ghcp-agent-rearchitect MayAssist Agent
```

Recommended input is the **Copilot Studio agent URL**, for example:

```text
/ghcp-agent-rearchitect https://copilotstudio.preview.microsoft.com/environments/<environmentId>/agents/<agentId>
```

or:

```text
/ghcp-agent-rearchitect https://copilotstudio.preview.microsoft.com/environments/<environmentId>/bots/<botId>/overview
```

Using the URL is more reliable than a display name because it includes the environment and agent id. The skill should use the current signed-in Power Platform/Copilot Studio account. If Microsoft sign-in shows an error such as “selected user account does not exist in tenant,” choose the account that owns the provided Copilot Studio environment or select **Use another account**.

The skill may also ask for:

- **Tenant ID or tenant domain**: GUID or domain such as `contoso.onmicrosoft.com`. Some Copilot Studio LSP calls require the tenant GUID; the skill can resolve a domain to a GUID before calling the tool.
- **Power Platform account email**: the account that has access to the environment/agent.
- **Source agent URL**: strongly preferred for source acquisition.
- **Target agent URL/name**: only needed when installing into an existing GHCP target.

For NLA Builder mode the skill derives the builder URL from the environment id:

```text
https://copilotstudio.preview.microsoft.com/environments/<environmentId>/build
```

No environment id is hard-coded in the package.

The skill will:

1. Locate/clone the source Copilot Studio agent.
2. Analyze the standard-harness source.
3. Extract a full resource inventory:
   - Dataverse table names and org URLs
   - connection reference logical names and connector IDs
   - SharePoint/knowledge URLs
   - topic flows, actions, triggers, variables, child agents, fallback/error/sign-in/reset behavior
4. Create:
   - `agent.ir.json`
   - `agent.target.ir.json`
   - `ghcp-rearchitecture-plan.md`
   - `ghcp-agent\instructions.md`
   - `ghcp-agent\nla-build-prompt.md`
   - `ghcp-agent\nla-build-prompt.short.md`
   - `ghcp-agent\behaviors\<skill>\skill.mcs.yml`
   - `ghcp-agent\behaviors\<skill>\SKILL.md`
   - `ghcp-agent\actions\action-designs.json`
   - `ghcp-agent\knowledge\knowledge-designs.json`
   - `ghcp-agent\ghcp-implementation-manifest.json`

## Creation/update modes

The skill asks how you want to proceed:

### 1. NLA Builder

Uses Copilot Studio `/build`:

```text
https://copilotstudio.preview.microsoft.com/environments/<environmentId>/build
```

The skill submits the generated `nla-build-prompt.short.md` and captures the generated agent/artifacts.

Use this when you want Copilot Studio to generate a new GHCP/NLA agent from the prompt.

### 2. API create

Uses a configured NLA create-agent API endpoint if available.

Set:

```text
CPS_NLA_CREATE_AGENT_URL
CPS_NLA_CREATE_AGENT_METHOD
CPS_NLA_CREATE_AGENT_TOKEN
```

Then the migrator can call:

```powershell
node .\bin\ghcp-agent-migrator.mjs nla-create `
  --prompt "<workdir>\ghcp-agent\nla-build-prompt.short.md" `
  --environment-id "<environmentId>" `
  --display-name "<newAgentName>" `
  --endpoint "<nlaCreateUrl>" `
  --access-token "<token>" `
  --out "<workdir>\ghcp-agent\nla-api-create-result.json"
```

Use this only when you have a supported endpoint and token.

### 3. Install into target

Use this when a blank/template GHCP agent already exists.

The skill clones that target agent, installs generated files, validates, and pushes after confirmation.

It uses the Copilot Studio GHCP harness agent file shape:

```text
behaviors/<skill-name>/skill.mcs.yml  kind: InlineAgentSkill
behaviors/<skill-name>/SKILL.md
settings.mcs.yml
.mcs/botdefinition.json instructions patch
```

Tools are only created as visible GHCP tools when a valid backing workflow/tool ID exists. Otherwise they remain in `actions/action-designs.json` as implementation requirements.

## Expected output

A successful run produces a local migration folder containing:

```text
agent.ir.json
agent.target.ir.json
ghcp-rearchitecture-plan.md
ghcp-agent/
  instructions.md
  nla-build-prompt.md
  nla-build-prompt.short.md
  settings.mcs.yml
  behaviors/
  skills/
  actions/action-designs.json
  knowledge/knowledge-designs.json
  ghcp-implementation-manifest.json
  generation-report.json
```

If pushed into a target GHCP agent, validation should show packaged skill payloads, and the cloned `.mcs\botdefinition.json` should contain visible skill components in addition to `BotSettingsComponent`.

## Important limitations

- This is a **sample skill**, not a Microsoft product feature.
- No warranty, guarantee, SLA, or official support is provided.
- Users are responsible for reviewing generated prompts, instructions, skills, tools, and knowledge settings.
- Do not publish generated agents without human review and tenant-specific testing.
- The skill can extract resource details only when they exist in the exported/cloned source files.
- Some GHCP surfaces, especially Tools and Knowledge, may require valid backing workflows, connector permissions, or API support.
- The NLA Builder may ask clarifying questions when required table names, connections, files, or SharePoint sites cannot be confidently inferred.

## Suggested GitHub publishing layout

Publish this folder as a repository:

```text
README.md
install.ps1
ghcp-agent-rearchitect/
  SKILL.md
  tools/ghcp-agent-migrator/
```

Consumers clone the repository, run `install.ps1`, reload Scout, and invoke:

```text
/ghcp-agent-rearchitect <agent name or URL>
```
