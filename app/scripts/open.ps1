# Opens Jarvis in the default browser, signed in: the link carries the token once and the browser keeps the cookie.
# Run:  powershell -ExecutionPolicy Bypass -File app\scripts\open.ps1
# The token never prints; it goes straight into the link.
$home_ = if ($env:JARVIS_HOME) { $env:JARVIS_HOME } else { Join-Path $HOME ".jarvis" }
$port = if ($env:JARVIS_PORT) { $env:JARVIS_PORT } else { 4317 }
$token = (Get-Content (Join-Path $home_ "app-token") -Raw).Trim()
Start-Process "http://127.0.0.1:$port/?t=$token"
