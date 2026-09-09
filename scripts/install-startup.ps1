param(
  [string]$AppUrl = "http://localhost:5173",
  [switch]$Kiosk
)

$startupDirectory = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDirectory '具身项目依赖台.lnk'
$edgePath = (Get-Command msedge.exe -ErrorAction SilentlyContinue).Source

if (-not $edgePath) {
  $edgeCandidates = @(
    "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  )
  $edgePath = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

if (-not $edgePath) {
  throw '未找到 Microsoft Edge，无法创建桌面应用快捷方式。'
}

$wallUrl = if ($AppUrl.Contains('?')) { "$AppUrl&wall=1" } else { "$AppUrl?wall=1" }

$arguments = if ($Kiosk) {
  "--kiosk $wallUrl --edge-kiosk-type=fullscreen"
} else {
  "--app=$AppUrl --start-maximized"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $edgePath
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.IconLocation = "$edgePath,0"
$shortcut.Description = '开机显示具身项目依赖与贡献看板'
$shortcut.Save()

Write-Host "已创建开机启动快捷方式：$shortcutPath"
