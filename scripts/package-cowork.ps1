param(
  [string]$Output = "dist\ghcp-agent-migrator-cowork.zip"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$stage = Join-Path $root "build\cowork"
$outPath = Join-Path $root $Output

Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stage | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outPath) | Out-Null

Copy-Item -Force (Join-Path $root "cowork\manifest.json") (Join-Path $stage "manifest.json")
Copy-Item -Force (Join-Path $root "cowork\color.png") (Join-Path $stage "color.png")
Copy-Item -Force (Join-Path $root "cowork\outline.png") (Join-Path $stage "outline.png")
Copy-Item -Force (Join-Path $root "LICENSE") (Join-Path $stage "LICENSE")
Copy-Item -Force (Join-Path $root "DISCLAIMER.md") (Join-Path $stage "DISCLAIMER.md")
Copy-Item -Force (Join-Path $root "PRIVACY.md") (Join-Path $stage "PRIVACY.md")
Copy-Item -Force (Join-Path $root "TERMS.md") (Join-Path $stage "TERMS.md")

$skillSource = Join-Path $root "skills\ghcp-agent-migrator"
$skillTarget = Join-Path $stage "skills\ghcp-agent-migrator"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $skillTarget) | Out-Null
Copy-Item -Recurse -Force $skillSource $skillTarget

Remove-Item -Force $outPath -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $outPath -Force

Write-Host "Wrote $outPath"
