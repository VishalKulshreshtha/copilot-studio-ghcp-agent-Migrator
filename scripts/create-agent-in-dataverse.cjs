'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function usage() {
  console.log(`Usage:
  node .\\scripts\\create-agent-in-dataverse.cjs --response <builder-response.json> --dataverse-url <url> --access-token <token> --display-name <agentName> --out <created-agent.json>

Options:
  --response       Builder API response file containing the SSE build event.
  --dataverse-url  Target Dataverse org URL, for example https://<org>.crm.dynamics.com.
  --access-token   Dataverse access token for the target org.
  --display-name   Display name for the generated agent.
  --out            Output JSON path. Defaults to created-agent.json beside the response file.

This script is a compatibility wrapper for the Code-generated Dataverse creation approach.
It creates the agent by delegating to:
  ghcp-agent-migrator commit-builder-response

No tenant, environment, user, org URL, token, or sample agent name is hard-coded.`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--help' || value === '-h') {
      args.help = true;
    } else if (value.startsWith('--')) {
      const key = value.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  usage();
  process.exit(0);
}

const response = args.response;
const dataverseUrl = args['dataverse-url'];
const accessToken = args['access-token'];
const displayName = args['display-name'];
const out = args.out ?? (response ? path.join(path.dirname(path.resolve(response)), 'created-agent.json') : undefined);

const missing = [];
if (!response) missing.push('--response');
if (!dataverseUrl) missing.push('--dataverse-url');
if (!accessToken) missing.push('--access-token');
if (!displayName) missing.push('--display-name');
if (!out) missing.push('--out');

if (missing.length) {
  usage();
  throw new Error(`Missing required option(s): ${missing.join(', ')}`);
}

if (!fs.existsSync(response)) {
  throw new Error(`Builder response file not found: ${response}`);
}

const repoRoot = path.resolve(__dirname, '..');
const cliCandidates = [
  path.join(repoRoot, 'bin', 'ghcp-agent-migrator.mjs'),
  path.join(repoRoot, 'bin', 'ghcp-agent-rearchitect.mjs'),
  path.join(repoRoot, 'ghcp-agent-migrator', 'tools', 'ghcp-agent-migrator', 'bin', 'ghcp-agent-migrator.mjs'),
  path.join(repoRoot, 'skills', 'ghcp-agent-migrator', 'tools', 'ghcp-agent-migrator', 'bin', 'ghcp-agent-migrator.mjs')
];

const cli = cliCandidates.find((candidate) => fs.existsSync(candidate));
if (!cli) {
  throw new Error(`Cannot find bundled ghcp-agent-migrator CLI. Checked:\n${cliCandidates.join('\n')}`);
}

const child = spawnSync(process.execPath, [
  cli,
  'commit-builder-response',
  '--response',
  response,
  '--dataverse-url',
  dataverseUrl,
  '--access-token',
  accessToken,
  '--display-name',
  displayName,
  '--out',
  out
], {
  stdio: 'inherit',
  windowsHide: true
});

process.exit(child.status ?? 1);
