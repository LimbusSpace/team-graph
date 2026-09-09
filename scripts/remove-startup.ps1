$startupDirectory = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDirectory '具身项目依赖台.lnk'

if (Test-Path -LiteralPath $shortcutPath) {
  Remove-Item -LiteralPath $shortcutPath
  Write-Host "已移除：$shortcutPath"
} else {
  Write-Host '未找到开机启动快捷方式。'
}
