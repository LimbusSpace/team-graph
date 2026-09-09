param(
  [Parameter(Mandatory = $true)][string]$TargetRepoPath,
  [string]$TeamGraphPath = (Split-Path -Parent $PSScriptRoot),
  [string]$DefaultNode,
  [ValidateSet('all', 'codex', 'claude-code', 'cursor', 'windsurf')][string]$Agent = 'all',
  [switch]$AutoPush,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$target = (Resolve-Path -LiteralPath $TargetRepoPath).Path
$graph = (Resolve-Path -LiteralPath $TeamGraphPath).Path
$root = (& git -C $target rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw "不是 Git 仓库：$target" }
if ([IO.Path]::GetFullPath($root).TrimEnd('\') -eq [IO.Path]::GetFullPath($graph).TrimEnd('\')) {
  throw '不能把 Team Graph 仓库安装为自己的 Agent Hook 目标。'
}

$sharedRoot = Join-Path $root '.team-graph'
$sharedHookDir = Join-Path $sharedRoot 'hooks'
$sharedHookPath = Join-Path $sharedHookDir 'team-graph-polyhook.cjs'
$localConfigPath = Join-Path $sharedRoot 'team-graph.local.json'
$templateScript = Join-Path $graph 'scripts\team-graph-polyhook.cjs'
$agents = if ($Agent -eq 'all') { @('codex', 'claude-code', 'cursor', 'windsurf') } else { @($Agent) }
$agentConfigPaths = @{
  codex = Join-Path $root '.codex\hooks.json'
  'claude-code' = Join-Path $root '.claude\settings.json'
  cursor = Join-Path $root '.cursor\hooks.json'
  windsurf = Join-Path $root '.windsurf\hooks.json'
}

if ($Uninstall) {
  foreach ($name in $agents) {
    $configPath = $agentConfigPaths[$name]
    if (Test-Path -LiteralPath $configPath) {
      $configText = Get-Content -Raw -LiteralPath $configPath
      if ($configText.Contains('.team-graph/hooks/team-graph-polyhook.cjs')) { Remove-Item -LiteralPath $configPath -Force }
    }
  }
  Remove-Item -LiteralPath $localConfigPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $sharedHookPath -Force -ErrorAction SilentlyContinue
  Write-Host "已移除 Team Graph polyhook：$root"
  exit 0
}

foreach ($name in $agents) {
  if (Test-Path -LiteralPath $agentConfigPaths[$name]) {
    throw "目标仓库已有 $($agentConfigPaths[$name])。请先人工合并对应 Agent 配置，避免覆盖现有 hooks。"
  }
}

New-Item -ItemType Directory -Force -Path $sharedHookDir | Out-Null
Copy-Item -LiteralPath $templateScript -Destination $sharedHookPath -Force
@{ teamGraphPath = $graph; autoPush = $AutoPush.IsPresent; defaultNode = $DefaultNode } |
  ConvertTo-Json | Set-Content -LiteralPath $localConfigPath -Encoding UTF8

foreach ($name in $agents) {
  $configPath = $agentConfigPaths[$name]
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $configPath) | Out-Null
  $config = switch ($name) {
    codex {
      @{ description = 'Update Team Graph after an Agent runs Git commands.'; hooks = @{ PostToolUse = @(@{ matcher = '^Bash$'; hooks = @(@{ type = 'command'; command = 'node "$(git rev-parse --show-toplevel)/.team-graph/hooks/team-graph-polyhook.cjs"'; commandWindows = 'node "$(git rev-parse --show-toplevel)/.team-graph/hooks/team-graph-polyhook.cjs"'; async = $true; timeout = 120; statusMessage = '同步 Team Graph 状态' }) }) }
    }
    'claude-code' { @{ hooks = @{ PostToolUse = @(@{ matcher = 'Bash'; hooks = @(@{ type = 'command'; command = 'node .team-graph/hooks/team-graph-polyhook.cjs'; timeout = 120 }) }) } } }
    cursor { @{ version = 1; hooks = @{ afterShellExecution = @(@{ command = 'node .team-graph/hooks/team-graph-polyhook.cjs' }) } } }
    windsurf { @{ hooks = @{ post_run_command = @(@{ command = 'node .team-graph/hooks/team-graph-polyhook.cjs' }) } } }
  }
  $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $configPath -Encoding UTF8
}

$excludePath = (& git -C $root rev-parse --git-path info/exclude).Trim()
if (-not [IO.Path]::IsPathRooted($excludePath)) { $excludePath = Join-Path $root $excludePath }
$excludeEntries = if (Test-Path -LiteralPath $excludePath) { Get-Content -LiteralPath $excludePath } else { @() }
if (-not ($excludeEntries -contains '.team-graph/team-graph.local.json')) {
  Add-Content -LiteralPath $excludePath -Value "`n# Team Graph local polyhook settings`n.team-graph/team-graph.local.json"
}

Write-Host "已安装 Team Graph polyhook：$root"
Write-Host "Agent：$($agents -join ', ')"
Write-Host "状态仓库：$graph"
Write-Host "autoPush：$($AutoPush.IsPresent)"
