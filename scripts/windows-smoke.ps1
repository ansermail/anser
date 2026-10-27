$ErrorActionPreference = 'Stop'
$installer = @(Get-ChildItem 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*-setup.exe')
if ($installer.Count -ne 1) { throw 'Expected one Windows installer.' }
$installPath = Join-Path $env:RUNNER_TEMP 'anser-windows-smoke'
$userChoicePath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.eml\UserChoice'
$userChoiceBefore = (Get-ItemProperty $userChoicePath -ErrorAction SilentlyContinue).ProgId
$extensionDefaults = @{}
foreach ($extension in @('eml', 'emlx', 'msg')) {
  $key = Get-Item "HKCU:\Software\Classes\.$extension" -ErrorAction SilentlyContinue
  $extensionDefaults[$extension] = if ($null -eq $key) { $null } else { $key.GetValue('') }
}
$setup = Start-Process $installer[0].FullName -ArgumentList @('/S', "/D=$installPath") -PassThru
if (-not $setup.WaitForExit(240000)) { Stop-Process $setup.Id -Force; throw 'Installer timed out.' }
if ($setup.ExitCode -ne 0) { throw "Installer failed: $($setup.ExitCode)" }
$exe = Join-Path $installPath 'anser.exe'
if (-not (Test-Path $exe)) { throw 'Installed app is missing.' }
$pe = [System.IO.BinaryReader]::new([System.IO.File]::OpenRead($exe))
try {
  $pe.BaseStream.Position = 0x3c
  $peOffset = $pe.ReadInt32()
  $pe.BaseStream.Position = $peOffset
  if ($pe.ReadUInt32() -ne 0x4550 -or $pe.ReadUInt16() -ne 0x8664) { throw 'Installed app is not Windows x64 PE.' }
} finally { $pe.Dispose() }
$expectedVersion = (Get-Content 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json).version
$installedVersion = (Get-Item $exe).VersionInfo.ProductVersion
if ($installedVersion -ne $expectedVersion) { throw 'Installed app version does not match the source.' }
foreach ($resource in @('LICENSE', 'NOTICE', 'LICENSING.md', 'licenses/shadcn-ui-MIT.txt')) {
  if (-not (Test-Path (Join-Path $installPath $resource))) { throw "Installed license resource is missing: $resource" }
}
$protocol = (Get-ItemProperty 'HKCU:\Software\Classes\anser\shell\open\command' -ErrorAction Stop).'(default)'
if ($protocol -notlike "*$exe*") { throw 'Notification protocol does not point to the installed app.' }
$userChoiceAfter = (Get-ItemProperty $userChoicePath -ErrorAction SilentlyContinue).ProgId
if ($userChoiceBefore -ne $userChoiceAfter) { throw 'Installer changed the protected file association.' }
foreach ($extension in @('eml', 'emlx', 'msg')) {
  $key = Get-Item "HKCU:\Software\Classes\.$extension" -ErrorAction SilentlyContinue
  $current = if ($null -eq $key) { $null } else { $key.GetValue('') }
  if ($extensionDefaults[$extension] -ne $current) { throw "Installer changed the default .$extension handler." }
  $command = (Get-ItemProperty "HKCU:\Software\Classes\dev.maildesk.desktop.$extension\shell\open\command").'(default)'
  if ($command -notlike "*$exe*") { throw "Optional .$extension handler is not registered." }
}
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--force-renderer-accessibility'
$app = $null
try {
  $app = Start-Process $exe -PassThru
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $ready = $false
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Milliseconds 1000
    $app.Refresh()
    if ($app.HasExited) { throw "App exited during startup: $($app.ExitCode)" }
    if ($app.MainWindowHandle -eq 0) { continue }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
    $zh = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '连接我的邮箱')
    $en = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Connect my mailbox')
    $condition = [System.Windows.Automation.OrCondition]::new($zh, $en)
    if ($null -ne $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)) { $ready = $true; break }
  }
  if (-not $ready) { throw 'The installed WebView2 app did not render its mailbox setup screen.' }
  $sample = Join-Path $env:RUNNER_TEMP 'anser-windows-smoke.eml'
  @'
From: Windows QA <qa@example.com>
To: Reader <reader@example.com>
Subject: Windows external mail QA
Date: Tue, 27 Oct 2026 10:00:00 +0000
MIME-Version: 1.0
Content-Type: text/html; charset=utf-8

<html><body><h1>WINDOWS-EML-BODY</h1><p>Fictional installer acceptance data.</p><a href="https://example.com/anser-windows-smoke">Windows external link</a></body></html>
'@ | Set-Content $sample -Encoding utf8
  Start-Process $exe -ArgumentList ('"' + $sample + '"') | Out-Null
  $desktop = [System.Windows.Automation.AutomationElement]::RootElement
  $owned = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $app.Id)
  $bodyCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'WINDOWS-EML-BODY')
  $linkCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Windows external link')
  $mailReady = $false
  $externalLink = $null
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    foreach ($window in $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $owned)) {
      if ($null -ne $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $bodyCondition)) {
        $externalLink = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $linkCondition)
        $mailReady = $true
        break
      }
    }
    if ($mailReady) { break }
  }
  if (-not $mailReady -or $null -eq $externalLink) { throw 'The external EML reader did not render the original body.' }
  $invoke = $externalLink.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $invoke.Invoke()
  $browserOpened = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    $browser = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('msedge.exe', 'chrome.exe', 'firefox.exe') -and $_.CommandLine -like '*https://example.com/anser-windows-smoke*' }
    if ($null -ne $browser) { $browserOpened = $true; break }
  }
  if (-not $browserOpened) { throw 'The real mail link click did not reach the system browser.' }
  @{ installer = 'passed'; architecture = 'x86_64'; version = $installedVersion; installerSha256 = (Get-FileHash $installer[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant(); appSha256 = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant(); licenseResources = $true; frontendReady = $true; externalMailReady = $true; nativeLinkClick = $true; protocolRegistered = $true; protectedAssociationUnchanged = $true } | ConvertTo-Json | Set-Content 'windows-smoke.json'
} finally {
  if ($null -ne $app -and -not $app.HasExited) { Stop-Process $app.Id -Force }
  $uninstaller = Join-Path $installPath 'uninstall.exe'
  if (Test-Path $uninstaller) {
    $uninstall = Start-Process $uninstaller -ArgumentList '/S' -PassThru
    if (-not $uninstall.WaitForExit(120000)) { Stop-Process $uninstall.Id -Force }
  }
}
