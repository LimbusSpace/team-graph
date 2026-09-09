param(
  [Parameter(Mandatory = $true)][string]$TargetRepoPath,
  [string]$TeamGraphPath = (Split-Path -Parent $PSScriptRoot),
  [string]$DefaultNode,
  [switch]$AutoPush,
  [switch]$Uninstall
)

$params = @{
  TargetRepoPath = $TargetRepoPath
  TeamGraphPath = $TeamGraphPath
  DefaultNode = $DefaultNode
  Agent = 'codex'
}
if ($AutoPush) { $params.AutoPush = $true }
if ($Uninstall) { $params.Uninstall = $true }
& (Join-Path $PSScriptRoot 'install-polyhook.ps1') @params
