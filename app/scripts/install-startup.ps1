# Puts a "Jarvis" shortcut in the Startup folder that starts the Jarvis web app at log-in, minimised.
# Run once:  powershell -ExecutionPolicy Bypass -File app\scripts\install-startup.ps1
# Undo:      powershell -ExecutionPolicy Bypass -File app\scripts\install-startup.ps1 -Remove
# It only writes the shortcut; it starts nothing now.
param([switch]$Remove)

$startup = [Environment]::GetFolderPath("Startup")
$link = Join-Path $startup "Jarvis.lnk"

if ($Remove) {
  if (Test-Path $link) { Remove-Item $link; Write-Host "Removed $link" } else { Write-Host "No shortcut at $link" }
  exit 0
}

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$node = (Get-Command node -ErrorAction Stop).Source
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($link)
$s.TargetPath = $node
$s.Arguments = "app\server\main.js"
$s.WorkingDirectory = $repo
$s.WindowStyle = 7  # minimised
$s.Description = "Jarvis web app (http://127.0.0.1:4317)"
$s.Save()
Write-Host "Created $link -> $node app\server\main.js in $repo"
