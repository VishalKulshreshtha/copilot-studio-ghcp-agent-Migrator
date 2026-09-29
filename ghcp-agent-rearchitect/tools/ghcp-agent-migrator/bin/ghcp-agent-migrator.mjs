#!/usr/bin/env node

import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import YAML from "yaml";

const IR_VERSION = "1.0";

function usage() {
  console.log(`Usage:
  ghcp-agent-migrator detect <copilot-studio-folder>
  ghcp-agent-migrator analyze <standard-agent-folder> --out <agent.ir.json>
  ghcp-agent-migrator generate --target-ir <agent.target.ir.json> --out <new-agent-folder>
  ghcp-agent-migrator nla-create --prompt <nla-build-prompt.md> --environment-id <id> --display-name <name> --endpoint <url> --access-token <token> --out <result.json>
  ghcp-agent-migrator install --source <ghcp-agent-folder> --target <cloned-target-agent-folder> [--clean]
  ghcp-agent-migrator prepare --solution <solution-unique-name> [--agent <agent-name-or-id>] [--environment <url-or-id>] [--workdir <folder>]
  ghcp-agent-migrator prepare --source-folder <exported-agent-folder> [--agent <agent-name-or-id>] [--workdir <folder>]

Examples:
  ghcp-agent-migrator detect "C:\\agents\\standard-agent"
  ghcp-agent-migrator analyze "C:\\agents\\standard-agent" --out "C:\\migration\\agent.ir.json"
  ghcp-agent-migrator generate --target-ir "C:\\migration\\agent.target.ir.json" --out "C:\\migration\\ghcp-agent"
  ghcp-agent-migrator nla-create --prompt "C:\\migration\\ghcp-agent\\nla-build-prompt.md" --environment-id "<envId>" --display-name "MayAssistGHCP" --endpoint "%CPS_NLA_CREATE_AGENT_URL%" --access-token "%CPS_NLA_CREATE_AGENT_TOKEN%" --out "C:\\migration\\ghcp-agent\\nla-api-create-result.json"
  ghcp-agent-migrator install --source "C:\\migration\\ghcp-agent" --target "C:\\migration\\target-cloud-agent" --clean
  ghcp-agent-migrator prepare --solution CustomerSupportSolution --agent "Customer Support Agent" --workdir "C:\\migration\\customer-support"
  ghcp-agent-migrator prepare --source-folder "C:\\exports\\customer-support" --workdir "C:\\migration\\customer-support"
  npm run analyze -- "C:\\agents\\standard-agent" --out ".\\agent.ir.json"`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command, positional: [] };

  for (let i = 0; i < rest.length; i += 1) {
    const value = rest[i];

    if (value.startsWith("--")) {
      const key = value.slice(2);
      const next = rest[i + 1];

      if (key === "help" || key === "h") {
        args.help = true;
      } else if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else if (value === "-h") {
      args.help = true;
    } else {
      args.positional.push(value);
    }
  }

  return args;
}

function runCommand(command, commandArgs, options = {}) {
  console.log(`> ${command} ${commandArgs.join(" ")}`);
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd,
    env: process.env,
    stdio: options.stdio ?? "inherit",
    shell: process.platform === "win32"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`);
  }

  return result;
}

function readCommand(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32"
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status
  };
}

function assertPacCliAvailable() {
  const result = readCommand("pac", ["--version"]);

  if (!result.ok) {
    throw new Error("Power Platform CLI 'pac' was not found or is not signed in. Install it, then run 'pac auth create' before prepare.");
  }

  return result.stdout.trim();
}

function sanitizeName(value) {
  return String(value).replace(/[^a-z0-9_.-]+/gi, "_").replace(/^_+|_+$/g, "") || "agent";
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }

}

function copyDirectoryFiltered(source, destination, options = {}) {
  fs.mkdirSync(destination, { recursive: true });
  const excludeNames = new Set(options.excludeNames ?? []);

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (excludeNames.has(entry.name)) {
      continue;
    }

    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryFiltered(sourcePath, destinationPath, options);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function recreateDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function findCopilotStudioAgentFolders(root) {
  const files = walkFiles(root);
  const agentFiles = files.filter((file) => path.basename(file) === "agent.mcs.yml");
  const candidates = [];

  for (const agentFile of agentFiles) {
    const folder = path.dirname(agentFile);
    const settingsFile = path.join(folder, "settings.mcs.yml");
    const topicsFolder = path.join(folder, "topics");
    const agentDoc = readYamlFile(agentFile);
    const settingsDoc = fs.existsSync(settingsFile) ? readYamlFile(settingsFile) : {};

    candidates.push({
      folder,
      displayName: agentDoc.displayName ?? agentDoc.name,
      id: agentDoc.id,
      schemaName: settingsDoc.schemaName ?? agentDoc.schemaName,
      hasSettingsFile: fs.existsSync(settingsFile),
      hasTopicsFolder: fs.existsSync(topicsFolder)
    });
  }

  return candidates;
}

function selectAgentFolder(candidates, requestedAgent) {
  if (candidates.length === 0) {
    throw new Error("No Copilot Studio agent folder was found. Expected a folder containing agent.mcs.yml, settings.mcs.yml, and topics\\*.mcs.yml.");
  }

  if (!requestedAgent) {
    if (candidates.length === 1) {
      return candidates[0];
    }

    const names = candidates.map((candidate) => `- ${candidate.displayName ?? candidate.id ?? candidate.folder} (${candidate.folder})`).join("\n");
    throw new Error(`Multiple agents were found. Re-run with --agent <name-or-id>.\n${names}`);
  }

  const requested = requestedAgent.toLowerCase();
  const matches = candidates.filter((candidate) =>
    [candidate.displayName, candidate.id, candidate.schemaName]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase() === requested)
  );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    throw new Error(`Multiple agents matched '${requestedAgent}'. Use the exact agent id or schema name.`);
  }

  const names = candidates.map((candidate) => `- ${candidate.displayName ?? candidate.id ?? candidate.folder} (${candidate.id ?? "no id"})`).join("\n");
  throw new Error(`No exported agent matched '${requestedAgent}'. Found:\n${names}`);
}

function prepareFromSourceFolder(sourceFolder, args) {
  const requestedAgent = args.agent;
  const workdir = path.resolve(args.workdir ?? path.join(process.cwd(), "migration-work", sanitizeName(requestedAgent ?? path.basename(sourceFolder))));
  const preparedSource = path.join(workdir, "source");
  const source = path.resolve(sourceFolder);

  if (isWithin(workdir, source)) {
    throw new Error("The --source-folder cannot be inside --workdir because prepare needs to clean its own source staging folder.");
  }

  fs.mkdirSync(workdir, { recursive: true });
  recreateDirectory(preparedSource);

  if (!isWithin(workdir, source)) {
    copyDirectory(source, preparedSource);
  }

  const scanRoot = preparedSource;
  const candidates = findCopilotStudioAgentFolders(scanRoot);
  const selected = selectAgentFolder(candidates, requestedAgent);
  const detection = detectCopilotStudioFolder(selected.folder);
  const ir = analyzeAgent(selected.folder);
  const irPath = writeJson(path.join(workdir, "agent.ir.json"), ir);
  const reportPath = writeJson(path.join(workdir, "prepare-report.json"), {
    workdir,
    selectedAgent: selected,
    detection,
    irPath
  });

  console.log(`Prepared ${workdir}`);
  console.log(`Selected agent folder: ${selected.folder}`);
  console.log(`Wrote ${irPath}`);
  console.log(`Wrote ${reportPath}`);
}

function prepareFromSolution(args) {
  const solution = args.solution;
  if (!solution) {
    throw new Error("Missing --solution <solution-unique-name>. PAC exports solutions, so the agent must be included in a Dataverse solution first.");
  }

  const pacVersion = assertPacCliAvailable();
  console.log(`Using Power Platform CLI: ${pacVersion}`);

  const workdir = path.resolve(args.workdir ?? path.join(process.cwd(), "migration-work", sanitizeName(solution)));
  const exportsDir = path.join(workdir, "exports");
  const unpackedDir = path.join(workdir, "unpacked-solution");
  const zipPath = path.join(exportsDir, `${sanitizeName(solution)}.zip`);

  fs.mkdirSync(workdir, { recursive: true });
  recreateDirectory(exportsDir);
  recreateDirectory(unpackedDir);

  const exportArgs = ["solution", "export", "--name", solution, "--path", zipPath, "--overwrite"];
  if (args.environment) {
    exportArgs.push("--environment", args.environment);
  }
  if (args.managed) {
    exportArgs.push("--managed");
  }

  runCommand("pac", exportArgs);

  const unpackArgs = [
    "solution",
    "unpack",
    "--zipfile",
    zipPath,
    "--folder",
    unpackedDir,
    "--packagetype",
    args.managed ? "Managed" : "Unmanaged",
    "--allowWrite",
    "--allowDelete",
    "--clobber"
  ];

  runCommand("pac", unpackArgs);

  const candidates = findCopilotStudioAgentFolders(unpackedDir);
  const selected = selectAgentFolder(candidates, args.agent);
  const detection = detectCopilotStudioFolder(selected.folder);
  const ir = analyzeAgent(selected.folder);
  const irPath = writeJson(path.join(workdir, "agent.ir.json"), ir);
  const reportPath = writeJson(path.join(workdir, "prepare-report.json"), {
    solution,
    environment: args.environment,
    zipPath,
    unpackedDir,
    selectedAgent: selected,
    detection,
    irPath
  });

  console.log(`Prepared ${workdir}`);
  console.log(`Selected agent folder: ${selected.folder}`);
  console.log(`Wrote ${irPath}`);
  console.log(`Wrote ${reportPath}`);
}

function readYamlFile(filePath) {
  try {
    return YAML.parse(fs.readFileSync(filePath, "utf8")) ?? {};
  } catch (error) {
    throw new Error(`Failed to parse YAML file ${filePath}: ${error.message}`);
  }
}

function walkFiles(root, suffix = ".mcs.yml") {
  const result = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      result.push(...walkFiles(fullPath, suffix));
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      result.push(fullPath);
    }
  }

  return result;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stableId(prefix, value) {
  const hash = crypto.createHash("sha256").update(value).digest("hex").slice(0, 10);
  return `${prefix}_${hash}`;
}

function relativeTo(root, file) {
  return path.relative(root, file);
}

function getNodeActions(doc) {
  const roots = [
    ...asArray(doc.beginDialog?.actions),
    ...asArray(doc.actions),
    ...asArray(doc.dialog?.beginDialog?.actions)
  ];

  const flattened = [];
  const visit = (node, pathPrefix = "") => {
    if (!node || typeof node !== "object") return;
    flattened.push({ ...node, _analysisPath: pathPrefix || node.id });

    for (const [key, value] of Object.entries(node)) {
      if (key === "dynamicInputSchema" || key === "dynamicOutputSchema") continue;
      if (key === "actions" || key === "elseActions" || key === "alwaysActions") {
        for (const [index, child] of asArray(value).entries()) {
          visit(child, `${pathPrefix || node.id || node.kind}.${key}[${index}]`);
        }
      }
      if (key === "conditions") {
        for (const [conditionIndex, condition] of asArray(value).entries()) {
          for (const [actionIndex, child] of asArray(condition.actions).entries()) {
            visit(child, `${pathPrefix || node.id || node.kind}.conditions[${conditionIndex}].actions[${actionIndex}]`);
          }
        }
      }
    }
  };

  for (const [index, root] of roots.entries()) {
    visit(root, `actions[${index}]`);
  }

  return flattened;
}

function getDisplayName(doc, file) {
  return doc.displayName ?? doc.name ?? doc.schemaName ?? path.basename(file, ".mcs.yml");
}

function extractText(value) {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(extractText).filter(Boolean).join(" ");
  }

  if (value && typeof value === "object") {
    return extractText(value.text ?? value.activity ?? value.value ?? "");
  }

  return "";
}

function truncateText(value, maxLength = 1200) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function compactRecord(record, keys) {
  const output = {};
  for (const key of keys) {
    if (record?.[key] !== undefined) output[key] = record[key];
  }
  return output;
}

function tryParseJson(value) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractAdaptiveCardText(node) {
  const cardText = [];
  const cards = [
    node.card,
    node.activity?.attachments?.[0]?.cardContent,
    ...asArray(node.activity?.attachments).map((attachment) => attachment.cardContent)
  ].filter(Boolean);

  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.text === "string") cardText.push(value.text);
    if (typeof value.title === "string") cardText.push(`Action: ${value.title}`);
    for (const child of Object.values(value)) visit(child);
  };

  for (const card of cards) {
    const parsed = tryParseJson(card);
    visit(parsed ?? card);
  }

  return [...new Set(cardText.map((text) => text.trim()).filter(Boolean))];
}

function classifyTrigger(trigger) {
  const kind = String(trigger.kind ?? trigger.type ?? "unknown");
  const intent = trigger.intent ?? {};
  const queries = [
    ...asArray(trigger.utterances),
    ...asArray(trigger.triggerQueries),
    ...asArray(intent.triggerQueries)
  ].map(String).filter(Boolean);

  if (/OnConversationStart|OnActivity|OnEventActivity/i.test(kind)) {
    return {
      type: "event",
      condition: trigger.condition,
      rawKind: kind
    };
  }

  if (/OnUnknownIntent|Fallback/i.test(kind)) {
    return {
      type: "fallback",
      condition: trigger.condition,
      rawKind: kind
    };
  }

  if (/OnRecognizedIntent|Intent|Trigger/i.test(kind)) {
    return {
      type: "utterance",
      displayName: intent.displayName ?? trigger.displayName,
      includeInOnSelectIntent: intent.includeInOnSelectIntent,
      examples: queries,
      condition: trigger.condition,
      rawKind: kind
    };
  }

  return {
    type: "unknown",
    condition: trigger.condition,
    rawKind: kind
  };
}

function classifyStep(node, index) {
  const kind = String(node.kind ?? node.type ?? "unknown");
  const id = node.id ?? stableId("step", `${kind}:${index}:${JSON.stringify(node).slice(0, 500)}`);
  const common = {
    id,
    rawKind: kind,
    sourcePath: node._analysisPath,
    displayName: node.displayName,
    condition: node.condition
  };

  if (/SendActivity/i.test(kind)) {
    return {
      ...common,
      type: "message",
      summary: "Sends a message to the user",
      message: truncateText(extractText(node.activity ?? node.activities ?? node.text)),
      cardText: extractAdaptiveCardText(node)
    };
  }

  if (/Question|TextInput|ChoiceInput|ConfirmInput/i.test(kind)) {
    return {
      ...common,
      type: "question",
      summary: "Asks the user for information",
      prompt: truncateText(extractText(node.prompt ?? node.activity ?? node.question)),
      outputMapping: node.property || node.variable ? { answer: String(node.property ?? node.variable) } : undefined,
      choices: asArray(node.choices).map((choice) => extractText(choice)).filter(Boolean),
      cardText: extractAdaptiveCardText(node)
    };
  }

  if (/ConditionGroup|IfCondition|SwitchCondition/i.test(kind)) {
    return {
      ...common,
      type: "condition",
      summary: "Branches the conversation based on a condition",
      condition: node.condition,
      branchCount: asArray(node.conditions).length,
      hasElse: asArray(node.elseActions).length > 0
    };
  }

  if (/SetProperty|SetVariable|SetProperties/i.test(kind)) {
    return {
      ...common,
      type: "variable-set",
      summary: "Sets one or more variables",
      target: node.property ?? node.variable,
      value: truncateText(node.value !== undefined ? JSON.stringify(node.value) : "")
    };
  }

  if (/BeginDialog|Redirect|Goto/i.test(kind)) {
    return {
      ...common,
      type: "topic-redirect",
      summary: "Redirects to another topic or dialog",
      target: node.dialog ?? node.topic ?? node.target
    };
  }

  if (/Invoke|Action|TaskDialog|External/i.test(kind)) {
    return {
      ...common,
      type: "action-call",
      summary: "Calls an action, connector, or tool",
      target: node.action ?? node.dialog ?? node.operationId ?? node.name,
      operationId: node.operationId,
      connectionReference: node.connectionReference,
      connectionMode: node.connectionProperties?.mode,
      inputBinding: node.input?.binding ? compactRecord(node.input.binding, ["entityName", "recordId", "item", "organization", "$select", "$filter"]) : undefined,
      outputVariable: node.output?.variable
    };
  }

  if (/Search|Knowledge/i.test(kind)) {
    return {
      ...common,
      type: "knowledge-search",
      summary: "Searches a knowledge source",
      target: node.knowledgeSource ?? node.source,
      userInput: node.userInput,
      outputVariable: node.variable
    };
  }

  if (/EndDialog|EndConversation/i.test(kind)) {
    return {
      ...common,
      type: "end",
      summary: "Ends the dialog or conversation",
      clearTopicQueue: node.clearTopicQueue
    };
  }

  return {
    ...common,
    type: "unknown",
    summary: `Unclassified node of kind ${kind}`,
    cardText: extractAdaptiveCardText(node)
  };
}

function collectDependencies(flow) {
  const dependencies = [];

  for (const step of flow) {
    if (!step.target) {
      continue;
    }

    if (step.type === "action-call") {
      dependencies.push({ type: "action", id: String(step.target) });
    }

    if (step.type === "topic-redirect") {
      dependencies.push({ type: "topic", id: String(step.target) });
    }

    if (step.type === "knowledge-search") {
      dependencies.push({ type: "knowledge", id: String(step.target) });
    }

    if (step.type === "variable-set") {
      dependencies.push({ type: "variable", id: String(step.target) });
    }
  }

  return dependencies;
}

function analyzeTopic(file, root) {
  const doc = readYamlFile(file);
  const flow = getNodeActions(doc).map(classifyStep);
  const triggerSources = [
    doc.beginDialog,
    ...(doc.beginDialog?.intent ? [doc.beginDialog.intent] : []),
    ...asArray(doc.triggers)
  ].filter(Boolean);

  return {
    id: doc.id ?? stableId("topic", relativeTo(root, file)),
    name: getDisplayName(doc, file),
    purpose: doc.description,
    sourceRef: {
      file: relativeTo(root, file),
      kind: doc.kind,
      originalId: doc.id
    },
    triggerKind: doc.beginDialog?.kind,
    modelDescription: doc.modelDescription,
    triggers: triggerSources.map(classifyTrigger),
    inputs: asArray(doc.inputs),
    outputs: asArray(doc.outputs),
    flow,
    dependencies: collectDependencies(flow),
    processSummary: flow.map((step, index) => ({
      order: index + 1,
      type: step.type,
      kind: step.rawKind,
      detail: step.message ?? step.prompt ?? step.condition ?? step.target ?? step.summary,
      target: step.target,
      operationId: step.operationId,
      outputVariable: step.outputVariable
    })),
    migrationIntent: flow.length > 20 ? "split" : "preserve",
    notes: flow.length > 20 ? ["Large topic detected; review whether it should be split for GHCP harness."] : []
  };
}

function analyzeAction(file, root) {
  const doc = readYamlFile(file);
  const connectorName =
    doc.connectionReference?.api?.name ??
    doc.connectorName ??
    doc.apiName ??
    doc.connectionName;

  return {
    id: doc.id ?? stableId("action", relativeTo(root, file)),
    name: getDisplayName(doc, file),
    type: connectorName ? "connector" : "unknown",
    purpose: doc.description,
    connectorName,
    operationId: doc.operationId ?? doc.actionId,
    inputs: asArray(doc.inputs),
    outputs: asArray(doc.outputs),
    usage: [],
    sourceRef: {
      file: relativeTo(root, file),
      kind: doc.kind,
      originalId: doc.id
    },
    migrationIntent: connectorName ? "preserve" : "needs-review"
  };
}

function analyzeVariable(file, root) {
  const doc = readYamlFile(file);

  return {
    name: doc.name ?? doc.displayName ?? path.basename(file, ".mcs.yml"),
    scope: "global",
    type: doc.type ?? doc.valueType ?? "unknown",
    purpose: doc.description,
    producers: [],
    consumers: [],
    sourceRef: {
      file: relativeTo(root, file),
      kind: doc.kind,
      originalId: doc.id
    }
  };
}

function analyzeKnowledgeSource(file, root) {
  const doc = readYamlFile(file);
  const source = doc.source ?? doc.url ?? doc.siteUrl ?? doc.fileUrl;
  const sourceText = String(source ?? "");

  let type = "unknown";
  if (/sharepoint/i.test(sourceText)) type = "sharepoint";
  if (/onedrive/i.test(sourceText)) type = "onedrive";
  if (/^https?:\/\//i.test(sourceText)) type = type === "unknown" ? "website" : type;

  return {
    id: doc.id ?? stableId("knowledge", relativeTo(root, file)),
    name: getDisplayName(doc, file),
    type,
    purpose: doc.description,
    source,
    usedByTopics: [],
    sourceRef: {
      file: relativeTo(root, file),
      kind: doc.kind,
      originalId: doc.id
    }
  };
}

function analyzeChildAgent(file, root) {
      const doc = readYamlFile(file);
      const folder = path.dirname(file);
      const knowledgeFiles = walkFiles(folder).filter((candidate) => candidate.includes(`${path.sep}knowledge${path.sep}`));

      return {
        id: doc.id ?? stableId("childAgent", relativeTo(root, file)),
        name: getDisplayName(doc, file),
        schemaName: doc["mcs.metadata"]?.schemaName ?? doc.schemaName,
        description: doc.beginDialog?.description ?? doc.description,
        instructions: doc.settings?.instructions ?? doc.instructions,
        triggerKind: doc.beginDialog?.kind,
        inputs: doc.inputType ?? {},
        outputs: doc.outputType ?? {},
        knowledgeRefs: knowledgeFiles.map((candidate) => relativeTo(root, candidate)),
        sourceRef: {
          file: relativeTo(root, file),
          kind: doc.kind,
          originalId: doc.id
        }
      };
}

function uniqueByJson(items) {
      const seen = new Set();
      const output = [];
      for (const item of items.filter(Boolean)) {
        const key = JSON.stringify(item);
        if (!seen.has(key)) {
          seen.add(key);
          output.push(item);
        }
      }
      return output;
}

function normalizeKnowledgeSourceValue(source) {
      if (!source) return {};
      if (typeof source === "string") return { url: source };
      if (typeof source === "object") return source;
      return { value: String(source) };
}

function buildResourceInventory({ topics, actions, knowledgeSources, connectionReferences }) {
      const dataverseTables = [];
      const dataverseOrganizations = [];
      const connectorReferences = [];
      const sharePointUrls = [];
      const fileKnowledge = [];

      for (const topic of topics) {
        for (const step of asArray(topic.flow)) {
          if (step.type !== "action-call") continue;
          const binding = step.inputBinding ?? {};
          if (binding.entityName || /Dataverse|WithOrganization|Record/i.test(step.operationId ?? step.target ?? "")) {
            dataverseTables.push({
              table: binding.entityName,
              operationId: step.operationId ?? step.target,
              organization: binding.organization,
              recordId: binding.recordId,
              select: binding.$select,
              filter: binding.$filter,
              item: binding.item,
              connectionReference: step.connectionReference,
              connectionMode: step.connectionMode,
              sourceTopic: topic.name,
              sourceStepId: step.id
            });
            if (binding.organization) dataverseOrganizations.push(binding.organization);
          }
          if (step.connectionReference) {
            connectorReferences.push({
              logicalName: step.connectionReference,
              mode: step.connectionMode,
              usedBy: `${topic.name}:${step.id}`
            });
          }
        }
      }

      for (const action of actions) {
        if (action.connectorName || action.operationId) {
          connectorReferences.push({
            logicalName: action.sourceRef?.file,
            connectorName: action.connectorName,
            operationId: action.operationId,
            usedBy: action.name
          });
        }
      }

      for (const source of knowledgeSources) {
        const normalized = normalizeKnowledgeSourceValue(source.source);
        const url = normalized.site ?? normalized.url ?? normalized.fileUrl ?? normalized.webSearchUrl;
        const entry = {
          name: source.name,
          type: source.type,
          url,
          site: normalized.site,
          fileUrl: normalized.fileUrl,
          sourceRef: source.sourceRef?.file
        };
        if (/sharepoint/i.test(JSON.stringify(normalized)) || /sharepoint/i.test(String(url ?? ""))) {
          sharePointUrls.push(entry);
        } else if (source.sourceRef?.file || source.name) {
          fileKnowledge.push(entry);
        }
      }

      for (const reference of asArray(connectionReferences?.connectionReferences)) {
        connectorReferences.push({
          logicalName: reference.connectionReferenceLogicalName,
          connectorId: reference.connectorId,
          source: "connectionreferences.mcs.yml"
        });
      }

      return {
        dataverseTables: uniqueByJson(dataverseTables).filter((entry) => entry.table || entry.operationId || entry.connectionReference),
        dataverseOrganizations: [...new Set(dataverseOrganizations.filter(Boolean))],
        sharePointUrls: uniqueByJson(sharePointUrls),
        fileKnowledge: uniqueByJson(fileKnowledge),
        connectorReferences: uniqueByJson(connectorReferences),
        missingResourceDetails: [
          dataverseTables.some((entry) => !entry.table) ? "Some Dataverse operations do not expose table names in the exported YAML." : undefined,
          sharePointUrls.length === 0 ? "No SharePoint URLs were discovered from knowledge source files." : undefined
        ].filter(Boolean)
      };
}

function buildSourceDossier({ root, agentDoc, settingsDoc, topics, actions, variables, knowledgeSources, childAgents, files }) {
          const connectionReferencesFile = files.find((file) => path.basename(file) === "connectionreferences.mcs.yml");
          const connectionReferences = connectionReferencesFile ? readYamlFile(connectionReferencesFile) : undefined;
          const resourceInventory = buildResourceInventory({ topics, actions, knowledgeSources, connectionReferences });

          return {
        agentIdentity: {
          displayName: getDisplayName(agentDoc, root),
          schemaName: settingsDoc.schemaName ?? agentDoc.schemaName,
          description: agentDoc.description,
          template: settingsDoc.template,
          language: settingsDoc.language,
          publishedOn: settingsDoc.publishedOn,
          accessControlPolicy: settingsDoc.accessControlPolicy,
          authenticationMode: settingsDoc.authenticationMode,
          authenticationTrigger: settingsDoc.authenticationTrigger
        },
        settings: {
          channels: asArray(settingsDoc.configuration?.channels).map((channel) => channel.channelId ?? channel),
          generativeActionsEnabled: Boolean(settingsDoc.configuration?.settings?.GenerativeActionsEnabled ?? settingsDoc.GenerativeActionsEnabled),
          recognizerKind: settingsDoc.configuration?.recognizer?.kind,
          isAgentConnectable: settingsDoc.configuration?.isAgentConnectable,
          isLightweightBot: settingsDoc.configuration?.isLightweightBot,
          gptSettings: settingsDoc.configuration?.gPTSettings,
          aiSettings: settingsDoc.configuration?.aISettings,
          capabilities: agentDoc.gptCapabilities,
          conversationStarters: asArray(agentDoc.conversationStarters),
          responseInstructions: agentDoc.responseInstructions
        },
        instructions: {
          agentInstructions: agentDoc.instructions,
          settingsInstructions: settingsDoc.instructions ?? settingsDoc.Instructions,
          behavioralRules: []
        },
        inventory: {
          topicCount: topics.length,
          actionCount: actions.length,
          variableCount: variables.length,
          knowledgeSourceCount: knowledgeSources.length,
          childAgentCount: childAgents.length,
          connectionReferencesPresent: Boolean(connectionReferencesFile)
        },
        processDetails: topics.map((topic) => ({
          name: topic.name,
          purpose: topic.purpose,
          triggerKind: topic.triggerKind,
          triggers: topic.triggers,
          flow: topic.processSummary,
          dependencies: topic.dependencies,
          sourceRef: topic.sourceRef
        })),
        actions: actions.map((action) => ({
          name: action.name,
          type: action.type,
          purpose: action.purpose,
          connectorName: action.connectorName,
          operationId: action.operationId,
          inputs: action.inputs,
          outputs: action.outputs,
          migrationIntent: action.migrationIntent,
          sourceRef: action.sourceRef
        })),
        knowledgeSources: knowledgeSources.map((source) => ({
          name: source.name,
          type: source.type,
          purpose: source.purpose,
          source: source.source,
          sourceRef: source.sourceRef
        })),
        variables: variables.map((variable) => ({
          name: variable.name,
          scope: variable.scope,
          type: variable.type,
          purpose: variable.purpose,
          sourceRef: variable.sourceRef
        })),
        childAgents,
        resourceInventory,
        connectionReferences: connectionReferences ? {
          sourceRef: relativeTo(root, connectionReferencesFile),
          summary: truncateText(JSON.stringify(connectionReferences), 4000)
        } : undefined
  };
}

function migrationNotesFor(ir) {
  const notes = [];

  for (const topic of ir.topics) {
    if (topic.migrationIntent === "split") {
      notes.push({
        severity: "warning",
        componentRef: topic.id,
        message: "Topic has many flow steps and may be too broad.",
        recommendation: "Consider splitting this into focused GHCP topics or child-agent flows."
      });
    }

    for (const step of topic.flow) {
      if (step.type === "unknown") {
        notes.push({
          severity: "warning",
          componentRef: `${topic.id}:${step.id}`,
          message: `Could not classify step kind '${step.rawKind}'.`,
          recommendation: "Review this step manually before generation."
        });
      }
    }
  }

  for (const action of ir.actions) {
    if (action.migrationIntent === "needs-review") {
      notes.push({
        severity: "warning",
        componentRef: action.id,
        message: "Action type could not be confidently identified.",
        recommendation: "Review whether this should become a connector action, MCP tool, or custom GHCP tool."
      });
    }
  }

  return notes;
}

function analyzeAgent(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Agent folder does not exist or is not a directory: ${root}`);
  }

  const files = walkFiles(root);
  const agentFile = files.find((file) => path.basename(file) === "agent.mcs.yml");
  const settingsFile = files.find((file) => path.basename(file) === "settings.mcs.yml");
  const agentDoc = agentFile ? readYamlFile(agentFile) : {};
  const settingsDoc = settingsFile ? readYamlFile(settingsFile) : {};

  const topics = files
    .filter((file) => file.includes(`${path.sep}topics${path.sep}`))
    .map((file) => analyzeTopic(file, root));

  const actions = files
    .filter((file) => file.includes(`${path.sep}actions${path.sep}`))
    .map((file) => analyzeAction(file, root));

  const variables = files
    .filter((file) => file.includes(`${path.sep}variables${path.sep}`))
    .map((file) => analyzeVariable(file, root));

  const knowledgeSources = files
    .filter((file) => file.includes(`${path.sep}knowledge${path.sep}`))
    .map((file) => analyzeKnowledgeSource(file, root));

  const childAgents = files
    .filter((file) => file.includes(`${path.sep}agents${path.sep}`) && path.basename(file) === "agent.mcs.yml")
    .map((file) => analyzeChildAgent(file, root));

  const ir = {
    irVersion: IR_VERSION,
    source: {
      harness: "standard",
      name: getDisplayName(agentDoc, root),
      schemaName: settingsDoc.schemaName ?? agentDoc.schemaName,
      sourcePath: path.resolve(root),
      detectedFeatures: [
        topics.length ? "topics" : undefined,
        actions.length ? "actions" : undefined,
        variables.length ? "variables" : undefined,
        knowledgeSources.length ? "knowledge" : undefined,
        childAgents.length ? "child-agents" : undefined,
        settingsDoc.configuration?.settings?.GenerativeActionsEnabled || settingsDoc.GenerativeActionsEnabled ? "generative-actions" : undefined
      ].filter(Boolean)
    },
    target: {
      harness: "ghcp",
      architectureStyle: "hybrid"
    },
    agent: {
      displayName: getDisplayName(agentDoc, root),
      description: agentDoc.description,
      primaryPurpose: agentDoc.description ?? "Needs review",
      generativeActionsEnabled: Boolean(settingsDoc.GenerativeActionsEnabled)
    },
    instructions: {
      systemInstructions: settingsDoc.instructions ?? settingsDoc.Instructions ?? "",
      behavioralRules: [],
      fallbackBehavior: undefined
    },
    topics,
    actions,
    knowledgeSources,
    variables,
    childAgents,
    orchestration: {
      style: settingsDoc.configuration?.settings?.GenerativeActionsEnabled || settingsDoc.GenerativeActionsEnabled ? "generative" : "classic",
      routingRules: [],
      toolInvocationRules: [],
      recommendedPatterns: []
    },
    guardrails: {
      toolCallLeakPrevention: false,
      privacyRules: []
    },
    diagnostics: {
      telemetryAvailable: false,
      tracePoints: []
    },
    migrationNotes: []
  };

  ir.sourceDossier = buildSourceDossier({
    root,
    agentDoc,
    settingsDoc,
    topics,
    actions,
    variables,
    knowledgeSources,
    childAgents,
    files
  });

  ir.migrationNotes = migrationNotesFor(ir);
  return ir;
}

function detectCopilotStudioFolder(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Folder does not exist or is not a directory: ${root}`);
  }

  const files = walkFiles(root);
  const basenames = new Set(files.map((file) => path.basename(file)));
  const hasAgentFile = basenames.has("agent.mcs.yml");
  const hasSettingsFile = basenames.has("settings.mcs.yml");
  const topicCount = files.filter((file) => file.includes(`${path.sep}topics${path.sep}`)).length;
  const actionCount = files.filter((file) => file.includes(`${path.sep}actions${path.sep}`)).length;
  const variableCount = files.filter((file) => file.includes(`${path.sep}variables${path.sep}`)).length;
  const knowledgeCount = files.filter((file) => file.includes(`${path.sep}knowledge${path.sep}`)).length;
  const mcsCount = files.length;
  const score = [
    hasAgentFile,
    hasSettingsFile,
    topicCount > 0,
    actionCount > 0,
    variableCount > 0,
    knowledgeCount > 0
  ].filter(Boolean).length;

  return {
    path: path.resolve(root),
    isCopilotStudioFolder: hasAgentFile && hasSettingsFile && topicCount > 0,
    confidence: score >= 4 ? "high" : score >= 2 ? "medium" : "low",
    markers: {
      agentFile: hasAgentFile,
      settingsFile: hasSettingsFile,
      mcsFileCount: mcsCount,
      topicCount,
      actionCount,
      variableCount,
      knowledgeCount
    },
    recommendation: hasAgentFile && hasSettingsFile && topicCount > 0
      ? "This looks like an exported Copilot Studio agent folder. You can run analyze next."
      : "This does not look like a complete exported Copilot Studio agent folder. Export/download the agent resources first, then run detect again."
  };
}

function writeJson(file, data) {
  const outputPath = path.resolve(file);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return outputPath;
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read JSON file ${file}: ${error.message}`);
  }
}

async function postJson(url, body, accessToken, method = "POST") {
  const response = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    },
    body: method.toUpperCase() === "GET" ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Keep raw text when the endpoint does not return JSON.
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body: parsed
  };
}

function writeYamlFile(file, data) {
  const outputPath = path.resolve(file);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, YAML.stringify(data), "utf8");
  return outputPath;
}

function writeTextFile(file, content) {
  const outputPath = path.resolve(file);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, "utf8");
  return outputPath;
}

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function toKebabCase(value, fallback = "component") {
  const sanitized = String(value ?? fallback)
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return sanitized || fallback;
}

function toPascalName(value, fallback = "GeneratedAgent") {
  const parts = String(value ?? fallback).match(/[a-z0-9]+/gi) ?? [fallback];
  return parts.map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join("");
}

function generatedNodeId(prefix, seed) {
  return `${prefix}_${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 7)}`;
}

function topicTriggerQueries(topic) {
  return asArray(topic.triggers)
    .flatMap((trigger) => asArray(trigger.examples))
    .map(String)
    .filter(Boolean)
    .slice(0, 10);
}

function makeGeneratedTopic(topic) {
  const topicName = topic.name ?? topic.id;
  const triggerQueries = topicTriggerQueries(topic);
  const intent = {
    displayName: topicName
  };

  if (triggerQueries.length > 0) {
    intent.triggerQueries = triggerQueries;
  }

  return {
    kind: "AdaptiveDialog",
    modelDescription: topic.purpose ?? `Handles ${topicName}.`,
    beginDialog: {
      kind: "OnRecognizedIntent",
      id: "main",
      intent,
      actions: [
        {
          kind: "SendActivity",
          id: generatedNodeId("send", topic.id ?? topicName),
          activity: `This GHCP re-architecture scaffold preserves the '${topicName}' capability. Review and implement the detailed flow from agent.target.ir.json.`
        }
      ]
    }
  };
}

function makeFallbackTopic() {
  return {
    kind: "AdaptiveDialog",
    beginDialog: {
      kind: "OnUnknownIntent",
      id: "main",
      actions: [
        {
          kind: "SendActivity",
          id: generatedNodeId("send", "fallback"),
          activity: "I could not match that request to a generated GHCP capability yet. Please try rephrasing or ask for help."
        }
      ]
    }
  };
}

function makeGeneratedVariable(variable) {
  return {
    kind: "GlobalVariableComponent",
    variableName: variable.name,
    type: variable.type && variable.type !== "unknown" ? variable.type : "String",
    description: variable.purpose ?? `Generated state placeholder for ${variable.name}.`,
    aIVisibility: "UseInAIContext"
  };
}

function buildGhcpInstructionText(ir) {
  const lines = [];
  const displayName = ir.target?.displayName ?? ir.agent?.targetDisplayName ?? ir.agent?.displayName ?? ir.source?.name ?? "the agent";
  const purpose = ir.target?.primaryPurpose ?? ir.agent?.primaryPurpose ?? ir.agent?.description;

  lines.push(`${displayName} is a GHCP rearchitecture of ${ir.source?.name ?? "the source Copilot Studio agent"}.`);
  if (purpose) {
    lines.push("", `Primary purpose: ${purpose}`);
  }

  const preservedRules = asArray(ir.agent?.instructionsStrategy?.preserve);
  const rewrittenRules = asArray(ir.agent?.instructionsStrategy?.rewrite);
  const systemInstructions = ir.instructions?.systemInstructions;
  if (systemInstructions) {
    lines.push("", "Source behavior to preserve:", systemInstructions);
  }
  if (preservedRules.length > 0 || rewrittenRules.length > 0) {
    lines.push("", "Behavior rules:");
    for (const rule of [...preservedRules, ...rewrittenRules]) {
      lines.push(`- ${rule}`);
    }
  }

  const routingRules = asArray(ir.orchestration?.routingRules);
  if (routingRules.length > 0) {
    lines.push("", "Routing rules:");
    for (const rule of routingRules) {
      lines.push(`- ${rule.id ?? rule.targetComponent}: ${rule.description ?? rule.decision ?? "Route according to the target IR."}`);
    }
  }

  const skills = asArray(ir.skills);
  if (skills.length > 0) {
    lines.push("", "Structured skill plan:");
    for (const skill of skills) {
      lines.push(`- ${skill.name ?? skill.id}: ${skill.purpose ?? skill.description ?? "Implement this generated GHCP skill scaffold."}`);
    }
  }

  const privacyRules = asArray(ir.guardrails?.privacyRules);
  if (ir.guardrails?.toolCallLeakPrevention || privacyRules.length > 0) {
    lines.push("", "Guardrails:");
    if (ir.guardrails?.toolCallLeakPrevention) {
      lines.push("- Never expose raw connector payloads, internal tool names, JSON, or tool-call reasoning to users.");
    }
    for (const rule of privacyRules) {
      lines.push(`- ${rule}`);
    }
  }

  lines.push(
    "",
    "If source metadata such as document version or sensitivity label is unavailable, state that it is unavailable rather than inventing it.",
    "Generated skill scaffolds and design files are implementation guidance; complete tool/knowledge binding before production use."
  );

  return lines.join("\n");
}

function buildBusinessInstructionText(ir) {
  const lines = [];
  const displayName = ir.target?.displayName ?? ir.agent?.targetDisplayName ?? ir.agent?.displayName ?? "the agent";
  const purpose = ir.target?.primaryPurpose ?? ir.agent?.primaryPurpose ?? ir.agent?.description;

  lines.push(`${displayName} helps employees with role-aware, consent-gated, knowledge-grounded assistance.`);
  if (purpose) {
    lines.push("", `Primary purpose: ${purpose}`);
  }

  const preservedRules = asArray(ir.agent?.instructionsStrategy?.preserve);
  const rewrittenRules = asArray(ir.agent?.instructionsStrategy?.rewrite);
  if (preservedRules.length > 0 || rewrittenRules.length > 0) {
    lines.push("", "Behavior rules:");
    for (const rule of [...preservedRules, ...rewrittenRules]) {
      lines.push(`- ${rule}`);
    }
  }

  const routingRules = asArray(ir.orchestration?.routingRules);
  if (routingRules.length > 0) {
    lines.push("", "Routing rules:");
    for (const rule of routingRules) {
      lines.push(`- ${rule.id ?? rule.targetComponent}: ${rule.description ?? rule.decision ?? "Route according to the design."}`);
    }
  }

  const skills = asArray(ir.skills);
  if (skills.length > 0) {
    lines.push("", "Structured skills:");
    for (const skill of skills) {
      lines.push(`- ${skill.name ?? skill.id}: ${skill.purpose ?? skill.description ?? "Implement this skill."}`);
    }
  }

  const privacyRules = asArray(ir.guardrails?.privacyRules);
  if (ir.guardrails?.toolCallLeakPrevention || privacyRules.length > 0) {
    lines.push("", "Guardrails:");
    if (ir.guardrails?.toolCallLeakPrevention) {
      lines.push("- Never expose raw connector payloads, internal tool names, JSON, or tool-call reasoning to users.");
    }
    for (const rule of privacyRules) {
      lines.push(`- ${rule}`);
    }
  }

  lines.push("", "If source metadata such as document version or sensitivity label is unavailable, state that it is unavailable rather than inventing it.");

  return lines.join("\n");
}

function bulletList(items, fallback = "- None captured.") {
  const values = asArray(items).filter(Boolean);
  return values.length > 0 ? values.map((item) => `- ${item}`).join("\n") : fallback;
}

function formatSourceDossierForPrompt(dossier) {
  if (!dossier) {
    return "No detailed source dossier was available. Use agent.target.ir.json and source files for final review.";
  }

  const topicLines = asArray(dossier.processDetails).map((topic) => {
    const triggerText = asArray(topic.triggers)
      .map((trigger) => {
        const examples = asArray(trigger.examples).slice(0, 8).join(", ");
        return `${trigger.rawKind}${trigger.displayName ? ` (${trigger.displayName})` : ""}${examples ? ` examples: ${examples}` : ""}`;
      })
      .join("; ") || topic.triggerKind || "No trigger captured";
    const flow = asArray(topic.flow)
      .slice(0, 30)
      .map((step) => `${step.order}. ${step.type}/${step.kind}: ${truncateText(step.detail ?? step.target ?? "", 220)}`)
      .join("\n  ");
    return `### ${topic.name}
- Purpose: ${topic.purpose ?? "Not documented"}
- Source: ${topic.sourceRef?.file}
- Trigger: ${triggerText}
- Dependencies: ${asArray(topic.dependencies).map((dep) => `${dep.type}:${dep.id}`).join(", ") || "None captured"}
- Process:
  ${flow || "No steps captured"}`;
  });

  const actionLines = asArray(dossier.actions).map((action) =>
    `- ${action.name}: type=${action.type}; connector=${action.connectorName ?? "unknown"}; operation=${action.operationId ?? "unknown"}; source=${action.sourceRef?.file}; purpose=${action.purpose ?? "not documented"}`
  );

  const knowledgeLines = asArray(dossier.knowledgeSources).map((source) =>
    `- ${source.name}: type=${source.type}; source=${typeof source.source === "string" ? source.source : JSON.stringify(source.source)}; purpose=${source.purpose ?? "not documented"}; file=${source.sourceRef?.file}`
  );

  const childAgentLines = asArray(dossier.childAgents).map((agent) =>
    `- ${agent.name}: trigger=${agent.triggerKind}; instructions=${truncateText(agent.instructions ?? "not documented", 500)}; knowledge=${asArray(agent.knowledgeRefs).join(", ") || "none captured"}; source=${agent.sourceRef?.file}`
  );

  const variableLines = asArray(dossier.variables).map((variable) =>
    `- ${variable.name}: scope=${variable.scope}; type=${variable.type}; purpose=${variable.purpose ?? "not documented"}`
  );
  const resources = dossier.resourceInventory ?? {};
  const dataverseLines = asArray(resources.dataverseTables).map((table) =>
    `- table=${table.table ?? "unknown"}; operation=${table.operationId ?? "unknown"}; organization=${table.organization ?? "current/default"}; connection=${table.connectionReference ?? "unknown"}; usedBy=${table.sourceTopic ?? table.usedBy ?? "unknown"}`
  );
  const sharePointLines = asArray(resources.sharePointUrls).map((source) =>
    `- ${source.name ?? "SharePoint source"}: ${source.url ?? source.site ?? "URL not captured"}`
  );
  const connectorLines = asArray(resources.connectorReferences).map((reference) =>
    `- ${reference.logicalName ?? reference.connectorName ?? "connection"}: ${reference.connectorId ?? reference.operationId ?? ""}${reference.usedBy ? `; usedBy=${reference.usedBy}` : ""}`
  );

  return `## Full source-agent dossier

### Identity and settings
- Display name: ${dossier.agentIdentity?.displayName}
- Schema name: ${dossier.agentIdentity?.schemaName}
- Description: ${dossier.agentIdentity?.description ?? "Not documented"}
- Template: ${dossier.agentIdentity?.template ?? "Unknown"}
- Published on: ${dossier.agentIdentity?.publishedOn ?? "Unknown"}
- Access control: ${dossier.agentIdentity?.accessControlPolicy ?? "Unknown"}
- Authentication: ${dossier.agentIdentity?.authenticationMode ?? "Unknown"} / ${dossier.agentIdentity?.authenticationTrigger ?? "Unknown"}
- Channels: ${asArray(dossier.settings?.channels).join(", ") || "None captured"}
- Recognizer: ${dossier.settings?.recognizerKind ?? "Unknown"}
- Generative actions enabled: ${Boolean(dossier.settings?.generativeActionsEnabled)}
- AI settings: ${truncateText(JSON.stringify(dossier.settings?.aiSettings ?? {}), 1000)}
- GPT settings: ${truncateText(JSON.stringify(dossier.settings?.gptSettings ?? {}), 1000)}
- Conversation starters: ${truncateText(JSON.stringify(dossier.settings?.conversationStarters ?? []), 1200)}

### Original instructions
${truncateText(dossier.instructions?.agentInstructions ?? dossier.instructions?.settingsInstructions ?? "No source instructions captured.", 3000)}

### Inventory
- Topics: ${dossier.inventory?.topicCount ?? 0}
- Actions: ${dossier.inventory?.actionCount ?? 0}
- Knowledge sources: ${dossier.inventory?.knowledgeSourceCount ?? 0}
- Variables: ${dossier.inventory?.variableCount ?? 0}
- Child agents: ${dossier.inventory?.childAgentCount ?? 0}
- Connection references present: ${Boolean(dossier.inventory?.connectionReferencesPresent)}

### Topic-by-topic process
${topicLines.join("\n\n") || "No topics captured."}

### Actions and tools
${actionLines.join("\n") || "- None captured."}

### Knowledge sources
${knowledgeLines.join("\n") || "- None captured."}

### Child agents
${childAgentLines.join("\n") || "- None captured."}

### Variables and state
${variableLines.join("\n") || "- None captured."}

### Discovered resources for tools and knowledge
Dataverse tables and operations:
${dataverseLines.join("\n") || "- None captured."}

Dataverse organizations:
${asArray(resources.dataverseOrganizations).map((org) => `- ${org}`).join("\n") || "- None captured."}

SharePoint / knowledge URLs:
${sharePointLines.join("\n") || "- None captured."}

Connector references:
${connectorLines.join("\n") || "- None captured."}

Missing resource details:
${asArray(resources.missingResourceDetails).map((detail) => `- ${detail}`).join("\n") || "- None."}

### Connection references
${dossier.connectionReferences?.summary ?? "No connection reference details captured."}`;
}

function buildNlaAgentPrompt(ir) {
  const displayName = ir.target?.displayName ?? "MayAssistGHCP";
  const purpose = ir.target?.primaryPurpose ?? ir.agent?.primaryPurpose ?? "Create an employee assistant with consent gating and role-aware grounded answers.";
  const skills = asArray(ir.skills);
  const routingRules = asArray(ir.orchestration?.routingRules);
  const knowledgeSources = asArray(ir.knowledgeSources);
  const actions = asArray(ir.actions);
  const guardrails = asArray(ir.guardrails?.privacyRules);
  const risks = asArray(ir.migrationRisks);

  return `Create a Microsoft Copilot Studio Agent named "${displayName}".

Build a complete business-ready employee assistant with clear instructions, structured skills, deterministic tools, and trusted knowledge connections.

## Goal

${purpose}

## Core behavior

${buildBusinessInstructionText(ir)}

${formatSourceDossierForPrompt(ir.sourceDossier)}

## User journey / exact process

1. When a conversation starts, verify whether the user has already accepted the employee acknowledgement and consent requirement.
2. If consent is missing or stale, show an acknowledgement/consent experience before answering any question or calling any tool.
3. If the user accepts, record the consent event and continue. If the user declines, stop assistance politely and do not search knowledge or call tools.
4. Resolve the user's role as MGCC, Branch Staff, or General/Unknown using available profile context, group/context signals, or a concise clarification question.
5. Route MGCC questions to MGCC-specific knowledge and tools.
6. Route Branch Staff questions to Branch Staff-specific knowledge and tools.
7. Route broad HR questions to the shared HR knowledge source.
8. Compose final answers centrally with citations, document version metadata, sensitivity label metadata when available, required AI disclaimer, feedback link, and conversation id.
9. If no grounded answer is found, say the requested information was not found in the configured knowledge sources and avoid unsupported speculation.
10. For repeated fallback, sign-in, reset/start-over, or errors, use safe production-hardened messages and diagnostic correlation information only.

## Skills to create

${skills.length > 0 ? skills.map((skill) => `- ${skill.name ?? skill.id}: ${skill.purpose ?? skill.description ?? "Create this as a reusable structured skill."}`).join("\n") : "- Consent Attestation\n- Role Aware Knowledge Router\n- Answer Composer and Feedback\n- Production Hardening"}

## Tools / actions to create or connect

${actions.length > 0 ? actions.map((action) => `- ${action.name ?? action.id}: ${action.purpose ?? action.decision ?? "Review and create a deterministic tool wrapper."}`).join("\n") : "- Dataverse consent lookup/check/create tools for cr87a_consents."}

Required Dataverse consent operations:
- getLatestConsentForUser(userEmail, botId)
- isConsentCurrentForPublishedBot(consentRecord, publishedOn)
- createConsentRecord(userEmail, botId, acceptedAt)

Use narrow deterministic tool wrappers. Do not expose a broad Dataverse MCP surface directly to users.

## Knowledge to connect

${knowledgeSources.length > 0 ? knowledgeSources.map((source) => `- ${source.name ?? source.id}: ${source.purpose ?? source.source?.site ?? source.source ?? "Review this knowledge source."}`).join("\n") : "- Shared HR knowledge\n- MGCC knowledge\n- Branch Staff knowledge\n- HR policies document"}

## Routing rules

${routingRules.length > 0 ? routingRules.map((rule) => `- ${rule.id ?? rule.targetComponent}: ${rule.description ?? rule.decision ?? "Route as defined by the target design."}`).join("\n") : "- Consent first, then role-aware knowledge routing, then answer composition."}

## Guardrails

${bulletList([
  ...(ir.guardrails?.toolCallLeakPrevention ? ["Never expose raw connector payloads, internal tool names, JSON, or tool-call reasoning to users."] : []),
  ...guardrails
])}

## Known risks to address in the generated design

${risks.length > 0 ? risks.map((risk) => `- ${risk.severity ?? "review"}: ${risk.risk} Mitigation: ${risk.mitigation}`).join("\n") : "- Verify consent logging, role routing, source access, and cross-channel adaptive card behavior before production."}

## Build requirements

- Build an Agent, not a workflow.
- Prefer natural-language instructions, skills, deterministic tools, and knowledge configuration.
- Keep the generated design as a draft until reviewed.
- Do not publish automatically.
`;
}

function buildConciseNlaAgentPrompt(ir, maxLength = 7800) {
  const displayName = ir.target?.displayName ?? "MayAssistGHCP";
  const dossier = ir.sourceDossier ?? {};
  const skills = asArray(ir.skills);
  const actions = asArray(ir.actions);
  const knowledgeSources = asArray(ir.knowledgeSources);
  const routingRules = asArray(ir.orchestration?.routingRules);
  const processDetails = asArray(dossier.processDetails);
  const resources = dossier.resourceInventory ?? {};

  const criticalTopics = processDetails.filter((topic) =>
    /ConversationStart|Greeting|Search|Fallback|Escalate|OnError|Signin|Formatresponse|EndofConversation|ResetConversation|StartOver|MultipleTopicsMatched/i.test(topic.name ?? "")
  );
  const roleTopics = processDetails.filter((topic) =>
    /MGCC|Branch|role/i.test(JSON.stringify(topic))
  );
  const selectedTopics = [...new Map([...criticalTopics, ...roleTopics].map((topic) => [topic.name, topic])).values()].slice(0, 12);

  const topicSummary = selectedTopics.map((topic) => {
    const flow = asArray(topic.flow)
      .slice(0, 8)
      .map((step) => `${step.order}:${step.type}${step.detail ? `=${truncateText(step.detail, 90)}` : ""}`)
      .join("; ");
    return `- ${topic.name} (${topic.triggerKind ?? "trigger"}): ${flow}`;
  }).join("\n");

  const prompt = `Create a Microsoft Copilot Studio Agent named "${displayName}".

Build a business-ready employee assistant using Instructions, Skills, Tools, and Knowledge.

Goal: ${ir.target?.primaryPurpose ?? ir.agent?.primaryPurpose ?? "Employee assistant with consent gating and role-aware grounded answers."}

Agent configuration: auth=${dossier.agentIdentity?.authenticationMode ?? "Integrated"}/${dossier.agentIdentity?.authenticationTrigger ?? "Always"}; channels=${asArray(dossier.settings?.channels).join(", ") || "Teams/M365 Copilot"}; recognizer=${dossier.settings?.recognizerKind ?? "GenerativeAIRecognizer"}; generativeActions=${Boolean(dossier.settings?.generativeActionsEnabled)}.

Behavior instructions:
${truncateText(dossier.instructions?.agentInstructions ?? ir.instructions?.systemInstructions ?? "", 1300)}

Exact process to implement:
1. On every new conversation, verify employee acknowledgement/consent before any answer, search, or tool call.
2. If consent missing/stale, show acknowledgement, record acceptance in Dataverse only after explicit agree, or stop assistance on decline.
3. Resolve role: MGCC, Branch Staff, or General/Unknown via profile/context or a short clarification.
4. Route MGCC to MGCC knowledge; Branch Staff to Branch Staff knowledge; broad HR to shared HR knowledge.
5. Compose final answers centrally with citations, document version, sensitivity label when available, AI disclaimer, feedback link, and conversation id.
6. If no grounded answer exists, say it was not found in configured knowledge and do not speculate.
7. Preserve safe fallback, escalation, sign-in, reset/start-over, disambiguation, and OnError diagnostics.

Key business flows:
${topicSummary || "- Consent, role routing, knowledge search, answer formatting, fallback/escalation, sign-in, reset, and error handling."}

Create these Skills:
${skills.map((skill) => `- ${skill.name ?? skill.id}: ${truncateText(skill.purpose ?? skill.description ?? "", 220)}`).join("\n") || "- Consent Attestation\n- Role Aware Knowledge Router\n- Answer Composer and Feedback\n- Production Hardening"}

Create/connect these Tools:
${actions.map((action) => `- ${action.name ?? action.id}: ${truncateText(action.purpose ?? action.decision ?? "", 220)}`).join("\n") || "- Dataverse consent lookup/check/create for cr87a_consents"}
- Discovered Dataverse details: ${asArray(resources.dataverseTables).map((table) => `${table.table ?? "unknown table"} via ${table.operationId ?? "operation"} (${table.organization ?? "current org"})`).join("; ") || "none captured"}
- Required Dataverse operations: getLatestConsentForUser(userEmail, botId); isConsentCurrentForPublishedBot(consentRecord, publishedOn); createConsentRecord(userEmail, botId, acceptedAt).
- Use narrow deterministic wrappers; never expose broad Dataverse MCP directly to users.

Connect Knowledge:
${knowledgeSources.map((source) => `- ${source.name ?? source.id}: ${truncateText(source.purpose ?? source.source?.site ?? source.source ?? "", 220)}`).join("\n") || "- Shared HR; MGCC; Branch Staff; HR policies document"}
- Discovered SharePoint/knowledge URLs: ${asArray(resources.sharePointUrls).map((source) => `${source.name ?? "source"}=${source.url ?? source.site}`).join("; ") || "none captured"}

Routing rules:
${routingRules.map((rule) => `- ${rule.id ?? rule.targetComponent}: ${truncateText(rule.description ?? rule.decision ?? "", 220)}`).join("\n") || "- consent-first; mgcc-role; branch-role; general-hr"}

Guardrails:
- Never search knowledge or call tools before consent.
- Do not ask for confidential/PII/customer/bank data unless explicitly approved.
- Never reveal raw connector payloads, JSON, internal tool names, or tool reasoning.
- If document version/sensitivity label is unavailable, say unavailable; do not invent it.
- Keep as draft; do not publish automatically.
`;

  if (prompt.length <= maxLength) {
    return prompt;
  }

  return `${prompt.slice(0, maxLength - 260)}

[Truncated to fit ${maxLength} characters. Preserve: consent-first flow, role-aware routing, Dataverse consent tools, knowledge grounding, answer composer, guardrails, and production hardening. Use full design files after creation for refinement.]`;
}

function buildImplementationManifest(ir, generatedFiles) {
  const visibleApiRequirements = {
    requiredForProductionGhcpAgent: true,
    reason: "The manage-agent GHCP sync overlay can push BotSettings/instructions but does not create visible GHCP Skills, Tools, or Knowledge cards in the Copilot Studio Build UI.",
    requiredApis: [
      {
        surface: "Skills",
        purpose: "Create visible structured instruction Skills from skills/*/SKILL.md.",
        inputs: ["skills-manifest.json", "skills/*/SKILL.md"]
      },
      {
        surface: "Tools",
        purpose: "Create visible deterministic tool wrappers for Dataverse consent lookup/check/create.",
        inputs: ["actions/action-designs.json"]
      },
      {
        surface: "Knowledge",
        purpose: "Connect SharePoint/file knowledge sources for All HR, Branch Staff, MGCC, and HR policies.",
        inputs: ["knowledge/knowledge-designs.json"]
      }
    ],
    completionCheck: [
      "Clone or inspect the target cloud agent after update.",
      "Confirm BotDefinition contains visible component records for Skills, Tools, and Knowledge, not only BotSettingsComponent.",
      "Confirm Copilot Studio Build UI shows non-empty Skills, Tools, and Knowledge sections."
    ]
  };

  return {
    displayName: ir.target?.displayName ?? `${ir.agent?.displayName ?? ir.source?.name ?? "Generated Agent"} GHCP`,
    purpose: ir.target?.primaryPurpose ?? ir.agent?.primaryPurpose,
    source: {
      name: ir.source?.name,
      schemaName: ir.source?.schemaName,
      sourcePath: ir.source?.sourcePath,
      sourceIrPath: ir.source?.sourceIrPath
    },
    generatedFiles,
    installableIntoGhcpTarget: true,
    pushRequirements: [
      "Existing GHCP target agent cloned with .mcs\\conn.json",
      "Run ghcp-agent-migrator install --source <ghcp-agent> --target <target-agent> --clean",
      "Run manage-agent validate against the target workspace",
      "Run manage-agent push only after explicit confirmation",
      "Use supported GHCP Skills/Tools/Knowledge APIs to create visible components; manage-agent settings push alone is not sufficient",
      "Publish only after separate explicit confirmation"
    ],
    artifacts: {
      instructions: "instructions.md",
      nlaPromptFull: "nla-build-prompt.md",
      nlaPromptShort: "nla-build-prompt.short.md",
      settingsScaffold: "settings.mcs.yml",
      actionDesigns: "actions\\action-designs.json",
      knowledgeDesigns: "knowledge\\knowledge-designs.json",
      skillsManifest: "skills\\skills-manifest.json",
      skillScaffolds: asArray(ir.skills).map((skill) => `skills\\${toKebabCase(skill.name ?? skill.id, "generated-skill")}\\SKILL.md`)
    },
    discoveredResources: ir.sourceDossier?.resourceInventory,
    visibleApiRequirements,
    coverage: {
      topics: ir.sourceDossier?.inventory?.topicCount ?? asArray(ir.topics).length,
      actions: ir.sourceDossier?.inventory?.actionCount ?? asArray(ir.actions).length,
      knowledgeSources: ir.sourceDossier?.inventory?.knowledgeSourceCount ?? asArray(ir.knowledgeSources).length,
      childAgents: ir.sourceDossier?.inventory?.childAgentCount ?? asArray(ir.childAgents).length,
      variables: ir.sourceDossier?.inventory?.variableCount ?? asArray(ir.variables).length
    }
  };
}

function skillFrontmatterValue(value) {
  return String(value ?? "").replaceAll("\"", "\\\"");
}

function makeSkillScaffold(skill) {
  const name = toKebabCase(skill.name ?? skill.id, "generated-skill");
  const description = skill.description ?? skill.purpose ?? `Generated GHCP skill scaffold for ${skill.name ?? skill.id}.`;
  const sourceRef = skill.sourceRef ? JSON.stringify(skill.sourceRef, null, 2) : "No source reference available.";
  const inputs = asArray(skill.inputs).map((input) => `- ${input.name ?? input.propertyName ?? input}`).join("\n") || "- Review source component and define required inputs.";
  const outputs = asArray(skill.outputs).map((output) => `- ${output.name ?? output.propertyName ?? output}`).join("\n") || "- Review source component and define expected outputs.";

  return {
    name,
    content: `---
name: "${skillFrontmatterValue(name)}"
description: "${skillFrontmatterValue(description)}"
---

# ${skill.name ?? name}

${description}

## Source

\`\`\`json
${sourceRef}
\`\`\`

## Migration intent

\`\`\`text
${skill.migrationIntent ?? "needs-review"}
\`\`\`

## Inputs

${inputs}

## Outputs

${outputs}

## Implementation notes

- This is a generated skill scaffold, not a complete implementation.
- Complete the tool/action binding for the GHCP harness runtime.
- Preserve privacy and permission behavior from the source Copilot Studio component.
- Add tests for success, missing input, authorization failure, and downstream tool failure.
`
  };
}

function makeInlineAgentSkillYaml(skill, schemaName) {
  const name = toKebabCase(skill.name ?? skill.id, "generated-skill");
  const componentName = name;
  return {
    "mcs.metadata": {
      componentName,
      description: skill.description ?? skill.purpose ?? `Generated GHCP skill ${componentName}.`,
      schemaName: `${schemaName}.skill.${componentName}`
    },
    kind: "InlineAgentSkill"
  };
}

function collectGeneratedSkills(ir) {
  const explicitSkills = asArray(ir.skills).map((skill) => ({
    id: skill.id ?? stableId("skill", skill.name ?? JSON.stringify(skill)),
    name: skill.name,
    description: skill.description,
    purpose: skill.purpose,
    inputs: skill.inputs,
    outputs: skill.outputs,
    migrationIntent: skill.migrationIntent ?? "preserve",
    sourceRef: skill.sourceRef
  }));

  const actionSkills = asArray(ir.actions)
    .filter((action) => ["wrap-as-tool", "replace", "needs-review"].includes(action.migrationIntent ?? ""))
    .map((action) => ({
      id: `skill_${action.id}`,
      name: action.name ?? action.id,
      description: action.purpose ?? `Skill wrapper for ${action.name ?? action.id}.`,
      purpose: action.purpose,
      inputs: action.inputs,
      outputs: action.outputs,
      migrationIntent: action.migrationIntent,
      sourceRef: action.sourceRef,
      sourceActionId: action.id,
      connectorName: action.connectorName,
      operationId: action.operationId
    }));

  const topicSkills = asArray(ir.topics)
    .filter((topic) => ["replace-with-action", "replace-with-orchestration"].includes(topic.migrationIntent ?? ""))
    .map((topic) => ({
      id: `skill_${topic.id}`,
      name: topic.name ?? topic.id,
      description: topic.purpose ?? `Skill extracted from ${topic.name ?? topic.id}.`,
      purpose: topic.purpose,
      inputs: topic.inputs,
      outputs: topic.outputs,
      migrationIntent: topic.migrationIntent,
      sourceRef: topic.sourceRef,
      sourceTopicId: topic.id
    }));

  const byName = new Map();
  for (const skill of [...explicitSkills, ...actionSkills, ...topicSkills]) {
    byName.set(toKebabCase(skill.name ?? skill.id, "generated-skill"), skill);
  }

  return [...byName.values()];
}

function generateGhcpAgent(args) {
  const targetIrPath = args["target-ir"] ?? args.ir ?? args.positional[0];
  const outDir = args.out;

  if (!targetIrPath) {
    throw new Error("Missing --target-ir <agent.target.ir.json>.");
  }

  if (!outDir) {
    throw new Error("Missing --out <new-agent-folder>.");
  }

  const ir = readJsonFile(targetIrPath);
  const outputRoot = path.resolve(outDir);
  const displayName = `${ir.agent?.displayName ?? ir.source?.name ?? "Generated Agent"} GHCP`;
  const schemaName = toKebabCase(ir.source?.schemaName ?? displayName).replace(/-/g, "_");
  const generatedFiles = [];

  recreateDirectory(outputRoot);
  for (const folder of ["actions", "knowledge", "skills", "behaviors", path.join("capabilities", "tools")]) {
    fs.mkdirSync(path.join(outputRoot, folder), { recursive: true });
  }

  generatedFiles.push(writeYamlFile(path.join(outputRoot, "agent.mcs.yml"), {
    kind: "GptComponentMetadata",
    schemaName,
    displayName,
    description: ir.agent?.description ?? ir.agent?.primaryPurpose ?? "Generated GHCP re-architecture scaffold."
  }));

  const instructionText = buildGhcpInstructionText(ir);
  const nlaPrompt = buildNlaAgentPrompt(ir);
  const conciseNlaPrompt = buildConciseNlaAgentPrompt(ir);
  generatedFiles.push(writeTextFile(path.join(outputRoot, "instructions.md"), `${instructionText}\n`));
  generatedFiles.push(writeTextFile(path.join(outputRoot, "nla-build-prompt.md"), `${nlaPrompt}\n`));
  generatedFiles.push(writeTextFile(path.join(outputRoot, "nla-build-prompt.short.md"), `${conciseNlaPrompt}\n`));
  generatedFiles.push(writeYamlFile(path.join(outputRoot, "settings.mcs.yml"), {
    displayName,
    schemaName,
    accessControlPolicy: "GroupMembership",
    authenticationMode: "Integrated",
    authenticationTrigger: "Always",
    configuration: {
      recognizer: {
        kind: "CLICopilotRecognizer"
      },
      agentSettings: {
        instructions: {
          segments: [
            {
              kind: "StaticSegment",
              value: instructionText
            }
          ]
        }
      }
    },
    generationNote: "This is a GHCP instruction scaffold. Install merges configuration.agentSettings.instructions.content into a cloned GHCP target agent; it does not create standard-topic YAML."
  }));

  const actionDesigns = asArray(ir.actions).map((action) => ({
    id: action.id,
    name: action.name,
    type: action.type,
    purpose: action.purpose,
    connectorName: action.connectorName,
    operationId: action.operationId,
    migrationIntent: action.migrationIntent ?? "needs-review",
    sourceRef: action.sourceRef,
    generationNote: "Connector actions require connection references and operation-specific inputs before they can be emitted as TaskDialog YAML."
  }));

  if (actionDesigns.length > 0) {
    generatedFiles.push(writeJson(path.join(outputRoot, "actions", "action-designs.json"), actionDesigns));
  }

  const knowledgeDesigns = asArray(ir.knowledgeSources).map((source) => ({
    id: source.id,
    name: source.name,
    type: source.type,
    purpose: source.purpose,
    source: source.source,
    sourceRef: source.sourceRef,
    generationNote: "Review source access and trigger conditions before generating final knowledge YAML."
  }));

  if (knowledgeDesigns.length > 0) {
    generatedFiles.push(writeJson(path.join(outputRoot, "knowledge", "knowledge-designs.json"), knowledgeDesigns));
  }

  const generatedSkills = collectGeneratedSkills(ir);
  const skillManifest = [];
  for (const skill of generatedSkills) {
    const scaffold = makeSkillScaffold(skill);
    const skillDir = path.join(outputRoot, "skills", scaffold.name);
    const skillPath = path.join(skillDir, "SKILL.md");
    generatedFiles.push(writeTextFile(skillPath, scaffold.content));
    const behaviorDir = path.join(outputRoot, "behaviors", scaffold.name);
    generatedFiles.push(writeYamlFile(path.join(behaviorDir, "skill.mcs.yml"), makeInlineAgentSkillYaml(skill, schemaName)));
    generatedFiles.push(writeTextFile(path.join(behaviorDir, "SKILL.md"), scaffold.content));
    skillManifest.push({
      name: scaffold.name,
      path: path.relative(outputRoot, skillPath),
      behaviorPath: path.relative(outputRoot, path.join(behaviorDir, "skill.mcs.yml")),
      sourceActionId: skill.sourceActionId,
      sourceTopicId: skill.sourceTopicId,
      connectorName: skill.connectorName,
      operationId: skill.operationId,
      migrationIntent: skill.migrationIntent ?? "needs-review"
    });
  }

  if (skillManifest.length > 0) {
    generatedFiles.push(writeJson(path.join(outputRoot, "skills", "skills-manifest.json"), skillManifest));
    generatedFiles.push(writeTextFile(path.join(outputRoot, "skills", "README.md"), `# Generated GHCP Skills

This folder contains skill scaffolds derived from \`agent.target.ir.json\`.

Generated skill count: ${skillManifest.length}

Each skill needs implementation binding, tests, and validation before it is used by the GHCP harness.
`));
  }

  const implementationManifestPath = writeJson(
    path.join(outputRoot, "ghcp-implementation-manifest.json"),
    buildImplementationManifest(ir, generatedFiles)
  );
  generatedFiles.push(implementationManifestPath);

  generatedFiles.push(writeTextFile(path.join(outputRoot, "README.md"), `# ${displayName}

Generated GHCP re-architecture scaffold.

## Next steps

1. Review generated GHCP instructions in instructions.md.
2. To create a new GHCP/NLA cloud agent through an API call, configure the NLA create endpoint and run ghcp-agent-migrator nla-create with nla-build-prompt.short.md if the API has an 8K prompt limit, otherwise use nla-build-prompt.md.
3. Complete connector/tool action designs from actions\\action-designs.json.
4. Complete knowledge source designs from knowledge\\knowledge-designs.json.
5. Complete generated skill design scaffolds from skills\\.
6. Use ghcp-implementation-manifest.json as the install/push checklist for an existing GHCP target agent.
7. Install into a cloned GHCP target agent only when updating an existing target; install merges instructions and design artifacts, not standard topics.
8. Pull/push/publish only after human review.

Source IR:

\`\`\`text
${path.resolve(targetIrPath)}
\`\`\`
`));

  const report = {
    sourceTargetIr: path.resolve(targetIrPath),
    outputRoot,
    generatedFiles,
    promptLengths: {
      full: nlaPrompt.length,
      short: conciseNlaPrompt.length
    },
    topicCount: 0,
    variableCount: 0,
    actionDesignCount: actionDesigns.length,
    knowledgeDesignCount: knowledgeDesigns.length,
    generatedSkillCount: skillManifest.length,
    warnings: [
      "This is a GHCP scaffold, not a fully validated production agent.",
      "GHCP output is instruction/skill/tool/knowledge design-first; standard topic and global variable YAML is intentionally not emitted.",
      "Connector actions and knowledge sources are emitted as design notes when required connection details are not available.",
      "Generated skills are scaffolds and require implementation binding, tests, and validation.",
      "Run Copilot Studio schema/LSP validation and complete manual review before push or publish."
    ]
  };

  const reportPath = writeJson(path.join(outputRoot, "generation-report.json"), report);
  console.log(`Generated GHCP agent scaffold: ${outputRoot}`);
  console.log(`Wrote ${reportPath}`);
  console.log(`Generated files: ${generatedFiles.length}`);
}

async function createNlaAgent(args) {
  const promptPath = path.resolve(args.prompt ?? args.positional[0] ?? "");
  const environmentId = args["environment-id"] ?? process.env.CPS_ENVIRONMENT_ID;
  const displayName = args["display-name"] ?? args.name ?? "Generated GHCP Agent";
  const endpoint = args.endpoint ?? process.env.CPS_NLA_CREATE_AGENT_URL;
  const method = args.method ?? process.env.CPS_NLA_CREATE_AGENT_METHOD ?? "POST";
  const accessToken = args["access-token"] ?? process.env.CPS_NLA_CREATE_AGENT_TOKEN;
  const outPath = path.resolve(args.out ?? path.join(path.dirname(promptPath || "."), "nla-api-create-result.json"));

  if (!promptPath || !fs.existsSync(promptPath)) {
    throw new Error("Missing or invalid --prompt <nla-build-prompt.md>.");
  }

  if (!environmentId) {
    throw new Error("Missing --environment-id <id> or CPS_ENVIRONMENT_ID.");
  }

  if (!endpoint) {
    throw new Error("Missing NLA create endpoint. Provide --endpoint <url> or CPS_NLA_CREATE_AGENT_URL. The migrator will not guess undocumented Copilot Studio endpoints or use browser automation.");
  }

  if (!accessToken) {
    throw new Error("Missing access token. Provide --access-token <token> or CPS_NLA_CREATE_AGENT_TOKEN for the configured NLA create endpoint.");
  }

  const prompt = fs.readFileSync(promptPath, "utf8");
  const request = {
    environmentId,
    displayName,
    buildType: "Agent",
    prompt,
    source: "ghcp-agent-rearchitect",
    promptPath
  };

  const result = await postJson(endpoint, request, accessToken, method);
  const persisted = {
    endpoint,
    method,
    request: {
      environmentId,
      displayName,
      buildType: "Agent",
      promptPath,
      promptLength: prompt.length,
      source: "ghcp-agent-rearchitect"
    },
    response: result
  };

  writeJson(outPath, persisted);

  if (!result.ok) {
    throw new Error(`NLA create API call failed with ${result.status} ${result.statusText}. Wrote ${outPath}.`);
  }

  console.log(`NLA create API call succeeded. Wrote ${outPath}`);
}

function installGhcpScaffold(args) {
  const source = path.resolve(args.source ?? args.positional[0] ?? "");
  const target = path.resolve(args.target ?? args.positional[1] ?? "");

  if (!source || !fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error("Missing or invalid --source <ghcp-agent-folder>.");
  }

  if (!target || !fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new Error("Missing or invalid --target <cloned-target-agent-folder>.");
  }

  const connPath = path.join(target, ".mcs", "conn.json");
  if (!fs.existsSync(connPath)) {
    throw new Error("Target must be a cloned Copilot Studio agent workspace containing .mcs\\conn.json.");
  }

  const sourceAgentFile = path.join(source, "agent.mcs.yml");
  if (!fs.existsSync(sourceAgentFile)) {
    throw new Error("Source scaffold must contain agent.mcs.yml.");
  }

  const backupDir = path.join(target, ".ghcp-migration-backup", timestampForPath());
  fs.mkdirSync(backupDir, { recursive: true });

  const componentNames = [
    "agent.mcs.yml",
    "settings.mcs.yml",
    "connectionreferences.mcs.yml",
    "topics",
    "actions",
    "knowledge",
    "variables",
    "agents",
    "skills",
    "behaviors",
    "capabilities"
  ];

  for (const name of componentNames) {
    const existing = path.join(target, name);
    if (!fs.existsSync(existing)) {
      continue;
    }

    const backupPath = path.join(backupDir, name);
    if (fs.statSync(existing).isDirectory()) {
      copyDirectory(existing, backupPath);
    } else {
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.copyFileSync(existing, backupPath);
    }
  }

  if (args.clean) {
    for (const name of ["topics", "variables", "actions", "knowledge", "agents", "skills", "behaviors", "capabilities"]) {
      fs.rmSync(path.join(target, name), { recursive: true, force: true });
    }
  }

  copyDirectoryFiltered(source, target, {
    excludeNames: new Set([".mcs", ".ghcp-migration-backup", "agent.mcs.yml", "settings.mcs.yml", "topics", "variables", "agents"])
  });

  const instructionsPath = path.join(source, "instructions.md");
  const targetSettingsPath = path.join(target, "settings.mcs.yml");
  if (fs.existsSync(instructionsPath) && fs.existsSync(targetSettingsPath)) {
    const instructions = fs.readFileSync(instructionsPath, "utf8").trim();
    const targetSettings = YAML.parse(fs.readFileSync(targetSettingsPath, "utf8"));
    targetSettings.configuration ??= {};
    targetSettings.configuration.agentSettings ??= {};
    targetSettings.configuration.agentSettings.instructions = {
      segments: [
        {
          kind: "StaticSegment",
          value: instructions
        }
      ]
    };
    fs.writeFileSync(targetSettingsPath, YAML.stringify(targetSettings), "utf8");

    const botDefinitionPath = path.join(target, ".mcs", "botdefinition.json");
    if (fs.existsSync(botDefinitionPath)) {
      const botDefinition = readJsonFile(botDefinitionPath);
      botDefinition.entity ??= {};
      botDefinition.entity.configuration ??= {};
      botDefinition.entity.configuration.agentSettings ??= {};
      botDefinition.entity.configuration.agentSettings.instructions = {
        "$kind": "Instructions",
        segments: [
          {
            "$kind": "StaticSegment",
            value: instructions.replace(/\s+/g, " ").trim()
          }
        ]
      };
      fs.writeFileSync(botDefinitionPath, JSON.stringify(botDefinition), "utf8");
    }
  }

  const reportPath = writeJson(path.join(target, "install-report.json"), {
    source,
    target,
    backupDir,
    clean: Boolean(args.clean),
    nextSteps: [
      "Run schema validation on generated .mcs.yml files.",
      "Run manage-agent validate against the target workspace.",
      "Run manage-agent push only after validation succeeds and the user confirms.",
      "Publish only after a separate explicit confirmation."
    ]
  });

  console.log(`Installed GHCP scaffold into target cloned agent: ${target}`);
  console.log(`Backup written to ${backupDir}`);
  console.log(`Wrote ${reportPath}`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.command || args.help || args.command === "help" || args.command === "--help" || args.command === "-h") {
    usage();
    return;
  }

  if (args.command === "detect") {
    const source = args.positional[0];
    if (!source) {
      usage();
      throw new Error("Missing required <copilot-studio-folder> argument.");
    }

    const detection = detectCopilotStudioFolder(source);
    console.log(JSON.stringify(detection, null, 2));
    return;
  }

  if (args.command === "prepare") {
    if (args["source-folder"]) {
      prepareFromSourceFolder(args["source-folder"], args);
      return;
    }

    prepareFromSolution(args);
    return;
  }

  if (args.command === "generate") {
    generateGhcpAgent(args);
    return;
  }

  if (args.command === "nla-create") {
    return createNlaAgent(args);
  }

  if (args.command === "install") {
    installGhcpScaffold(args);
    return;
  }

  if (args.command !== "analyze") {
    throw new Error(`Unknown command: ${args.command}`);
  }

  const source = args.positional[0];
  if (!source) {
    usage();
    throw new Error("Missing required <standard-agent-folder> argument.");
  }

  const ir = analyzeAgent(source);
  const out = writeJson(args.out ?? "agent.ir.json", ir);

  console.log(`Wrote ${out}`);
  console.log(`Topics: ${ir.topics.length}`);
  console.log(`Actions: ${ir.actions.length}`);
  console.log(`Variables: ${ir.variables.length}`);
  console.log(`Knowledge sources: ${ir.knowledgeSources.length}`);
  console.log(`Migration notes: ${ir.migrationNotes.length}`);
}

try {
  await run();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
