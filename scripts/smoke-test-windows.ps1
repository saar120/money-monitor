$ErrorActionPreference = 'Stop'

$installer = Get-ChildItem 'release/Money-Monitor-Setup-*.exe' | Select-Object -First 1
if (!$installer) { throw 'Windows installer was not produced' }
$installDir = Join-Path $env:RUNNER_TEMP 'Money Monitor Installed'
$process = Start-Process -FilePath $installer.FullName -ArgumentList '/S', "/D=$installDir" -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Installer exited with code $($process.ExitCode)" }

node scripts/smoke-test-packaged-desktop.mjs (Join-Path $installDir 'Money Monitor.exe')
if ($LASTEXITCODE -ne 0) { throw 'Installed Windows app smoke test failed' }
