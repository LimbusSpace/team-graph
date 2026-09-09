param(
  [Parameter(Mandatory = $true)][string]$TargetRepoPath,
  [string]$TeamGraphPath = (Split-Path -Parent $PSScriptRoot),
  [string]$DefaultNode,
  [switch]$AutoPush,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$target = (Resolve-Path -LiteralPath $TargetRepoPath).Path
$graph = (Resolve-Path -LiteralPath $TeamGraphPath).Path
$root = (& git -C $target rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw "不是 Git 仓库：$target" }
$codex = Join-Path $root '.codex'
$hookDir = Join-Path $codex 'hooks'
$configPath = Join-Path $codex 'hooks.json'
$teamConfigPath = Join-Path $codex 'team-graph.local.json'
$legacyTeamConfigPath = Join-Path $codex 'team-graph.json'
$templateConfig = Join-Path $graph '.codex\hooks.json'
$templateScript = Join-Path $graph '.codex\hooks\team-graph-post-tool.cjs'

if ($Uninstall) {
  if (Test-Path -LiteralPath $configPath) {
    $configText = Get-Content -Raw -LiteralPath $configPath
    if ($configText.Contains('同步 Team Graph 状态')) { Remove-Item -LiteralPath $configPath -Force }
  }
  Remove-Item -LiteralPath $teamConfigPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $legacyTeamConfigPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $hookDir 'team-graph-post-tool.cjs') -Force -ErrorAction SilentlyContinue
  Write-Host "已移除项目级 Codex Team Graph hook：$root"
  exit 0
}

if (Test-Path -LiteralPath $configPath) {
  throw "目标仓库已有 .codex/hooks.json。请先人工合并 Team Graph hook，避免覆盖现有 Codex hooks。"
}

New-Item -ItemType Directory -Force -Path $hookDir | Out-Null
Copy-Item -LiteralPath $templateConfig -Destination $configPath -Force
Copy-Item -LiteralPath $templateScript -Destination (Join-Path $hookDir 'team-graph-post-tool.cjs') -Force
@{
  teamGraphPath = $graph
  autoPush = $AutoPush.IsPresent
  defaultNode = $DefaultNode
} | ConvertTo-Json | Set-Content -LiteralPath $teamConfigPath -Encoding UTF8

$excludePath = (& git -C $root rev-parse --git-path info/exclude).Trim()
if (-not [IO.Path]::IsPathRooted($excludePath)) {
  $excludePath = Join-Path $root $excludePath
}
$excludeEntries = if (Test-Path -LiteralPath $excludePath) { Get-Content -LiteralPath $excludePath } else { @() }
if (-not ($excludeEntries -contains '.codex/team-graph.local.json')) {
  Add-Content -LiteralPath $excludePath -Value "`n# Team Graph local Codex hook settings`n.codex/team-graph.local.json"
}

Write-Host "已安装项目级 Codex hook：$root"
Write-Host "状态仓库：$graph"
Write-Host "autoPush：$($AutoPush.IsPresent)"
