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
  $pe.BaseStream.Position = $peOffset + 24 + 68
  if ($pe.ReadUInt16() -ne 2) { throw 'Installed app uses the console subsystem instead of Windows GUI.' }
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
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AnserWindowNative {
  [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr window);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr window);
}
'@
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
  $mainWindow = $app.MainWindowHandle
  if ([AnserWindowNative]::GetMenu($mainWindow) -ne [IntPtr]::Zero) { throw 'The Windows main window has an unexpected native menu bar.' }
  function Find-WindowAction([string[]]$labels) {
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      $element = [System.Windows.Automation.AutomationElement]::FromHandle($mainWindow)
      foreach ($label in $labels) {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $label)
        $action = $element.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
        if ($null -ne $action -and $action.Current.IsEnabled) { return $action }
      }
      Start-Sleep -Milliseconds 100
    }
    throw "The accessible custom window action was not found: $($labels -join ', ')"
  }
  $maximize = Find-WindowAction @('最大化窗口', 'Maximize window')
  $maximize.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  $restore = Find-WindowAction @('还原窗口', 'Restore window')
  if (-not [AnserWindowNative]::IsZoomed($mainWindow)) { throw 'The custom maximize button did not maximize the native window.' }
  $restore.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  $minimize = Find-WindowAction @('最小化窗口', 'Minimize window')
  if ([AnserWindowNative]::IsZoomed($mainWindow)) { throw 'The custom restore button did not restore the native window.' }
  $minimize.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  for ($i = 0; $i -lt 30 -and [AnserWindowNative]::IsWindowVisible($mainWindow); $i++) { Start-Sleep -Milliseconds 100 }
  if ([AnserWindowNative]::IsWindowVisible($mainWindow)) { throw 'Minimizing did not hide the main window to the system tray.' }
  $desktop = [System.Windows.Automation.AutomationElement]::RootElement
  $buttons = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
  $trayButton = $null
  for ($i = 0; $i -lt 20; $i++) {
    $allButtons = $desktop.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($button in $allButtons) {
      if ($button.Current.Name -match '^(雁信|Anser)(\s|$)') { $trayButton = $button; break }
    }
    if ($null -ne $trayButton) { break }
    if ($i -eq 0) {
      foreach ($button in $allButtons) {
        if ($button.Current.AutomationId -eq 'NotificationChevron' -or $button.Current.Name -match '(?i)show hidden icons|notification chevron|显示隐藏.*图标') {
          $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
          break
        }
      }
    }
    Start-Sleep -Milliseconds 250
  }
  if ($null -eq $trayButton) {
    $allButtons | ForEach-Object {
      $item = $_.Current
      if ($item.ProcessId -ne $app.Id -and $item.Name) {
        [PSCustomObject]@{ name = $item.Name; type = $item.ControlType.ProgrammaticName; id = $item.AutomationId; class = $item.ClassName; offscreen = $item.IsOffscreen }
      }
    } | ConvertTo-Json -Depth 3 | Set-Content 'windows-tray-diagnostics.json' -Encoding utf8
    throw 'The installed app system tray icon could not be found; see windows-tray-diagnostics.json.'
  }
  $trayInvoke = $null
  if ($trayButton.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$trayInvoke)) {
    $trayInvoke.Invoke()
  } else {
    $trayButton.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern).DoDefaultAction()
  }
  for ($i = 0; $i -lt 30 -and -not [AnserWindowNative]::IsWindowVisible($mainWindow); $i++) { Start-Sleep -Milliseconds 100 }
  if (-not [AnserWindowNative]::IsWindowVisible($mainWindow)) { throw 'The real tray click did not restore the main window.' }
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
        if ([AnserWindowNative]::GetMenu([IntPtr]$window.Current.NativeWindowHandle) -ne [IntPtr]::Zero) { throw 'The Windows external mail window has an unexpected native menu bar.' }
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
  @{ installer = 'passed'; architecture = 'x86_64'; version = $installedVersion; installerSha256 = (Get-FileHash $installer[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant(); appSha256 = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant(); windowsGuiSubsystem = $true; customWindowControls = $true; nativeMenuAbsent = $true; minimizeToTray = $true; trayRestore = $true; licenseResources = $true; frontendReady = $true; externalMailReady = $true; nativeLinkClick = $true; protocolRegistered = $true; protectedAssociationUnchanged = $true } | ConvertTo-Json | Set-Content 'windows-smoke.json'
} finally {
  if ($null -ne $app -and -not $app.HasExited) { Stop-Process $app.Id -Force }
  $uninstaller = Join-Path $installPath 'uninstall.exe'
  if (Test-Path $uninstaller) {
    $uninstall = Start-Process $uninstaller -ArgumentList '/S' -PassThru
    if (-not $uninstall.WaitForExit(120000)) { Stop-Process $uninstall.Id -Force }
  }
}
