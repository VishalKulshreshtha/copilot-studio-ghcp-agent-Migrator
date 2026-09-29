param(
  [string]$SkillRoot = "$env:USERPROFILE\.scout\m-skills",
  [switch]$InstallCopilotStudioExtension
)

$ErrorActionPreference = "Stop"

$packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceSkill = Join-Path $packageRoot "ghcp-agent-rearchitect"
$targetSkill = Join-Path $SkillRoot "ghcp-agent-rearchitect"
$migrator = Join-Path $targetSkill "tools\ghcp-agent-migrator"
$manageAgent = Join-Path $env:USERPROFILE ".copilot\installed-plugins\skills-for-copilot-studio\copilot-studio\scripts\manage-agent.bundle.js"
$copilotStudioExtensions = @()
if (Test-Path "$env:USERPROFILE\.vscode\extensions") {
  $copilotStudioExtensions = Get-ChildItem "$env:USERPROFILE\.vscode\extensions" -Directory -Filter "ms-copilotstudio.vscode-copilotstudio*" -ErrorAction SilentlyContinue
}

if (-not (Test-Path $sourceSkill)) {
  throw "Cannot find packaged skill folder: $sourceSkill"
}

New-Item -ItemType Directory -Force -Path $SkillRoot | Out-Null

if (Test-Path $targetSkill) {
  Remove-Item -Recurse -Force $targetSkill
}

Copy-Item -Recurse -Force $sourceSkill $targetSkill

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required but was not found on PATH. Install Node.js 20+ from https://nodejs.org/ or with winget: winget install OpenJS.NodeJS.LTS"
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required but was not found on PATH. Install Node.js/npm and rerun this script."
}

$nodeVersionText = (& node --version).TrimStart("v")
$nodeMajor = [int]($nodeVersionText.Split(".")[0])
if ($nodeMajor -lt 20) {
  throw "Node.js 20+ is required. Found node $nodeVersionText. Upgrade Node.js and rerun this script."
}

if (-not $copilotStudioExtensions -and $InstallCopilotStudioExtension) {
  if (Get-Command code -ErrorAction SilentlyContinue) {
    Write-Host "Installing Copilot Studio VS Code extension..."
    code --install-extension ms-copilotstudio.vscode-copilotstudio
    if (Test-Path "$env:USERPROFILE\.vscode\extensions") {
      $copilotStudioExtensions = Get-ChildItem "$env:USERPROFILE\.vscode\extensions" -Directory -Filter "ms-copilotstudio.vscode-copilotstudio*" -ErrorAction SilentlyContinue
    }
  } else {
    Write-Warning "VS Code 'code' CLI was not found, so the Copilot Studio extension could not be installed automatically."
  }
}

if (-not $copilotStudioExtensions) {
  Write-Warning "Copilot Studio VS Code extension was not detected. Install it from VS Code Marketplace: ms-copilotstudio.vscode-copilotstudio"
}

if (-not (Test-Path $manageAgent)) {
  Write-Warning "skills-for-copilot-studio manage-agent bundle was not found at: $manageAgent"
  Write-Warning "Install or clone skills-for-copilot-studio so manage-agent.bundle.js is available before running clone/push operations."
}

Push-Location $migrator
try {
  npm install
} finally {
  Pop-Location
}

Write-Host "Installed ghcp-agent-rearchitect skill to: $targetSkill"
Write-Host "Node.js: $(node --version)"
if ($copilotStudioExtensions) {
  Write-Host "Copilot Studio VS Code extension detected: $($copilotStudioExtensions[0].FullName)"
}
if (Test-Path $manageAgent) {
  Write-Host "manage-agent bundle detected: $manageAgent"
}
Write-Host "Reload Microsoft Scout, then run: /ghcp-agent-rearchitect <agent name or URL>"
