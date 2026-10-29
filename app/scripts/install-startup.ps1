# Puts a "Jarvis" shortcut in the Startup folder that starts the Jarvis web app at log-in, minimised, and a
# "Jarvis" shortcut on the desktop that opens the app in the browser, signed in (app\scripts\open.ps1).
# Run once:  powershell -ExecutionPolicy Bypass -File app\scripts\install-startup.ps1
# Undo:      powershell -ExecutionPolicy Bypass -File app\scripts\install-startup.ps1 -Remove
# It only writes the shortcut; it starts nothing now.
param([switch]$Remove)

$startup = [Environment]::GetFolderPath("Startup")
$link = Join-Path $startup "Jarvis.lnk"
$desk = Join-Path ([Environment]::GetFolderPath("Desktop")) "Jarvis.lnk"

if ($Remove) {
  foreach ($l in @($link, $desk)) {
    if (Test-Path $l) { Remove-Item $l; Write-Host "Removed $l" } else { Write-Host "No shortcut at $l" }
  }
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

$d = $shell.CreateShortcut($desk)
$d.TargetPath = (Get-Command powershell -ErrorAction Stop).Source
$d.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$repo\app\scripts\open.ps1`""
$d.WorkingDirectory = $repo
$d.WindowStyle = 7
$d.Description = "Open Jarvis in the browser, signed in"
$d.Save()
Write-Host "Created $desk -> opens Jarvis signed in"
