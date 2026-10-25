# Downloads the Node.js version used to build mJournal into .tools\node.
# The archive is checked against the official SHA-256 checksum before use.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$version = 'v24.21.0'
$root = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $root '.tools'
$target = Join-Path $tools 'node'
if (Test-Path (Join-Path $target 'node.exe')) { exit 0 }

New-Item -ItemType Directory -Force $tools | Out-Null
$name = "node-$version-win-x64"
$zip = Join-Path $tools "$name.zip"
Write-Host "  Downloading Node.js $version from nodejs.org..."
Invoke-WebRequest -Uri "https://nodejs.org/dist/$version/$name.zip" -OutFile $zip -UseBasicParsing
$sums = (Invoke-WebRequest -Uri "https://nodejs.org/dist/$version/SHASUMS256.txt" -UseBasicParsing).Content
$expected = (($sums -split "`n") | Where-Object { $_ -match "\s$name\.zip$" }) -replace '\s+.*$', ''
$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if (-not $expected -or $expected.Trim() -ne $actual) {
  Remove-Item $zip -Force
  throw "The Node.js download did not match its published checksum, so it was not used."
}
Expand-Archive -Path $zip -DestinationPath $tools -Force
Move-Item (Join-Path $tools $name) $target
Remove-Item $zip -Force
Write-Host "  Node.js is ready in .tools\node"
