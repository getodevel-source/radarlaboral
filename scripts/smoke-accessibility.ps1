param(
  [string]$Version
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw -Encoding utf8 (Join-Path $root 'package.json') | ConvertFrom-Json
if (-not $Version) { $Version = $manifest.version }
$exe = Join-Path $root "release/$Version/win-unpacked/Radar Laboral.exe"
if (-not (Test-Path -LiteralPath $exe)) { throw "Build the Windows package first: $exe" }
$releaseRoot = Split-Path -Parent (Split-Path -Parent $exe)

$timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH-mm-ss-fffZ')
$qaRoot = Join-Path $root ".qa-accessibility-$Version-$timestamp"
$userData = Join-Path $qaRoot 'user-data'
New-Item -ItemType Directory -Path $userData -Force | Out-Null
$seedCode = @'
import { RadarDatabase } from './electron/database.ts'
const database = new RadarDatabase(process.argv[1])
database.addSource({ name: 'QA pending feed', url: 'https://example.org/qa-pending.xml', kind: 'rss', profileId: null, enabled: false, automationEvidenceUrl: '' })
database.addSource({ name: 'QA approved paused feed', url: 'https://example.org/qa-approved-paused.xml', kind: 'rss', profileId: null, enabled: false, customAutomationApproved: true, automationEvidenceUrl: '' })
database.addResume({ name: 'QA resume', originalName: 'qa-resume.pdf', pageCount: 1, extractedText: 'Synthetic QA resume content.', bytes: new TextEncoder().encode('%PDF-1.4\n% synthetic QA fixture\n') })
database.addOpportunity({ profileId: null, title: 'QA analyst', company: 'QA employer', location: 'Remote', source: 'QA fixture', url: 'https://example.org/qa-opportunity', description: 'Synthetic QA opportunity.', salaryText: '' })
database.close()
'@
Push-Location $root
try {
  & node --experimental-strip-types --input-type=module -e $seedCode $userData
  if ($LASTEXITCODE -ne 0) { throw 'Could not seed isolated custom feeds for accessibility verification.' }
} finally { Pop-Location }
$app = Start-Process -FilePath $exe -ArgumentList @("--radar-user-data-dir=$userData", '--force-renderer-accessibility') -PassThru

try {
  $window = $null
  $deadline = (Get-Date).AddSeconds(25)
  while ((Get-Date) -lt $deadline) {
    $app.Refresh()
    if ($app.HasExited) { throw "Radar exited during startup with code $($app.ExitCode)" }
    if ($app.MainWindowHandle -ne 0) {
      $window = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
      break
    }
    Start-Sleep -Milliseconds 250
  }
  if ($null -eq $window) { throw 'Radar window did not appear in Windows UI Automation' }

  function Get-Nodes {
    $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  }

  function Find-Button([string]$name) {
    foreach ($node in (Get-Nodes)) {
      try { $current = $node.Current } catch { continue }
      if ($null -eq $current -or $null -eq $current.ControlType) { continue }
      if ($current.ControlType.ProgrammaticName -eq 'ControlType.Button' -and ($current.Name -eq $name -or ($name -in @('Vacantes', 'Mis CV', 'Fuentes') -and $current.Name -match "^$([regex]::Escape($name)) \d+$"))) { return $node }
    }
    return $null
  }

  function Get-Snapshot([string]$label) {
    $interactive = @()
    $unnamed = @()
    $focused = @()
    $windows = @()
    foreach ($node in (Get-Nodes)) {
      try { $current = $node.Current } catch { continue }
      if ($null -eq $current -or $null -eq $current.ControlType) { continue }
      $type = $current.ControlType.ProgrammaticName.Replace('ControlType.', '')
      $name = [string]$current.Name
      if ($current.HasKeyboardFocus) { $focused += [pscustomobject]@{ type = $type; name = $name } }
      if ($type -in @('Button', 'Edit', 'ComboBox', 'CheckBox', 'RadioButton', 'Spinner', 'TabItem', 'ListItem', 'Hyperlink', 'MenuItem')) {
        $interactive += [pscustomobject]@{ type = $type; name = $name }
        if ([string]::IsNullOrWhiteSpace($name)) { $unnamed += $type }
      }
      if ($type -eq 'Window' -and $name -and $name -ne 'Radar Laboral') { $windows += $name }
    }
    [pscustomobject]@{
      label = $label
      interactiveControls = $interactive.Count
      unnamedInteractiveControls = $unnamed.Count
      focusedControls = $focused
      dialogWindowNames = $windows
      buttons = @($interactive | Where-Object type -eq 'Button' | ForEach-Object name)
      fields = @($interactive | Where-Object type -in @('Edit', 'ComboBox', 'CheckBox', 'RadioButton', 'Spinner') | ForEach-Object { [pscustomobject]@{ type = $_.type; name = $_.name } })
    }
  }

  function Wait-ForButton([string]$name, [int]$timeoutSeconds = 30) {
    $limit = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $limit) {
      $button = Find-Button $name
      if ($null -ne $button) { return $button }
      Start-Sleep -Milliseconds 250
    }
    $visibleButtons = @((Get-Nodes) | Where-Object { $_.Current.ControlType.ProgrammaticName -eq 'ControlType.Button' } | ForEach-Object { $_.Current.Name } | Where-Object { $_ })
    throw "Named button did not appear in UI Automation: $name. Visible buttons: $($visibleButtons -join ' | ')"
  }

  function Wait-ForDialogClosed([string]$dialog, [string]$label) {
    $snapshot = Get-Snapshot $label
    $limit = (Get-Date).AddSeconds(5)
    while ($snapshot.dialogWindowNames -contains $dialog -and (Get-Date) -lt $limit) {
      Start-Sleep -Milliseconds 150
      $snapshot = Get-Snapshot $label
    }
    $snapshot
  }

  $ready = Wait-ForButton 'Resumen' 60
  $screens = @()
  foreach ($screen in @('Resumen', 'Búsquedas', 'Vacantes', 'Mis CV', 'Fuentes', 'Preferencias')) {
    $navigation = Wait-ForButton $screen
    try { $navigation.SetFocus() } catch {}
    $navigation.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Milliseconds 350
    $snapshot = Get-Snapshot $screen
    $screens += [pscustomobject]@{
      screen = $screen
      interactiveControls = $snapshot.interactiveControls
      unnamedInteractiveControls = $snapshot.unnamedInteractiveControls
      buttons = $snapshot.buttons
      fields = $snapshot.fields
    }
  }
  $expectedMenus = @('Archivo', 'Editar', 'Ver', 'Ventana')
  $defaultEnglishMenus = @('File', 'Edit', 'View', 'Window')
  $menuLabels = @($screens[0].buttons | Where-Object { $_ -in $expectedMenus } | Select-Object -Unique)
  $englishMenuLabels = @($screens[0].buttons | Where-Object { $_ -in $defaultEnglishMenus } | Select-Object -Unique)

  $dialogScenarios = @(
    [pscustomobject]@{ screen = 'Resumen'; trigger = 'Crear búsqueda'; expectedWindow = 'Nueva búsqueda' },
    [pscustomobject]@{ screen = 'Vacantes'; trigger = 'Agregar vacante'; expectedWindow = 'Guardar una vacante' },
    [pscustomobject]@{ screen = 'Fuentes'; trigger = 'Agregar una fuente personalizada'; expectedWindow = 'Agregar una fuente' }
  )
  $dialogs = @()
  foreach ($scenario in $dialogScenarios) {
    $navigationName = if ($scenario.screen -eq 'Resumen') { 'Ir al resumen' } else { $scenario.screen }
    $navigation = Wait-ForButton $navigationName
    try { $navigation.SetFocus() } catch {}
    $navigation.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Milliseconds 350
    $trigger = Wait-ForButton $scenario.trigger
    try { $trigger.SetFocus() } catch {}
    $trigger.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Milliseconds 500
    $opened = Get-Snapshot $scenario.expectedWindow
    $focusOnField = $false
    foreach ($control in $opened.focusedControls) {
      if ($control.type -in @('Edit', 'ComboBox', 'CheckBox', 'RadioButton', 'Spinner')) { $focusOnField = $true }
    }
    $modalVisible = $opened.dialogWindowNames -contains $scenario.expectedWindow
    $cancel = Wait-ForButton 'Cancelar'
    try { $cancel.SetFocus() } catch {}
    $cancel.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    $closed = Wait-ForDialogClosed $scenario.expectedWindow "after cancel: $($scenario.expectedWindow)"
    $dialogs += [pscustomobject]@{
      dialog = $scenario.expectedWindow
      appearedInWindowsUiAutomation = $modalVisible
      interactiveControls = $opened.interactiveControls
      unnamedInteractiveControls = $opened.unnamedInteractiveControls
      fields = $opened.fields
      focusOnFormControl = $focusOnField
      cancelButtonAvailable = $true
      closedWithCancel = -not ($closed.dialogWindowNames -contains $scenario.expectedWindow)
      navigationRestored = $null -ne (Find-Button $scenario.screen)
    }
  }

  $vacancies = Wait-ForButton 'Vacantes'
  try { $vacancies.SetFocus() } catch {}
  $vacancies.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  $prepare = Wait-ForButton 'Preparar'
  try { $prepare.SetFocus() } catch {}
  $prepare.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  $createCopy = Wait-ForButton 'Crear copia PDF'
  try { $createCopy.SetFocus() } catch {}
  $createCopy.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()

  $saveDialog = $null
  $desktopWindowNames = @()
  $nativeWindowCandidates = @()
  $nativeDialogDeadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $nativeDialogDeadline -and $null -eq $saveDialog) {
    $desktopWindows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    $topLevelWindows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    $desktopWindowNames = @($topLevelWindows | ForEach-Object {
      try { [pscustomobject]@{ name = $_.Current.Name; type = $_.Current.ControlType.ProgrammaticName; processId = $_.Current.ProcessId } } catch { $null }
    } | Where-Object { $null -ne $_ -and $_.processId -eq $app.Id })
    foreach ($desktopWindow in $desktopWindows) {
      try { $current = $desktopWindow.Current } catch { continue }
      if ($null -ne $current -and $current.ControlType.ProgrammaticName -eq 'ControlType.Window') {
        if ($current.ProcessId -eq $app.Id) { $nativeWindowCandidates += [pscustomobject]@{ name = $current.Name; processId = $current.ProcessId } }
        if ($current.Name -eq 'Guardar copia del CV') { $saveDialog = $desktopWindow; break }
      }
    }
    if ($null -eq $saveDialog) { Start-Sleep -Milliseconds 200 }
  }

  $nativeSaveDialog = [pscustomobject]@{
    appearedInWindowsUiAutomation = $null -ne $saveDialog
    title = if ($null -ne $saveDialog) { $saveDialog.Current.Name } else { $null }
    interactiveControls = 0
    unnamedInteractiveControls = 0
    buttons = @()
    fields = @()
    cancelButtonAvailable = $false
    saveButtonAvailable = $false
    closedWithCancel = $false
    desktopTopLevelWindows = $desktopWindowNames
    processWindowCandidates = @($nativeWindowCandidates | Select-Object -Unique)
    processId = $null
    className = $null
    frameworkId = $null
  }
  if ($null -ne $saveDialog) {
    Start-Sleep -Milliseconds 900
    $keyboardFocusSequence = @()
    try { $saveDialog.SetFocus() } catch {}
    for ($tabIndex = 0; $tabIndex -lt 24; $tabIndex++) {
      try {
        $focusedElement = [System.Windows.Automation.AutomationElement]::FocusedElement
        $focused = $focusedElement.Current
        $focusType = if ($null -ne $focused.ControlType) { $focused.ControlType.ProgrammaticName.Replace('ControlType.', '') } else { '' }
        $focusName = if ($focused.Name -in @('Save', 'Cancel', 'Save as type:', 'Search Box', 'Organize', 'Navigation Pane', 'Up band', 'QA resume - QA employer - QA analyst')) { [string]$focused.Name } else { '' }
        $keyboardFocusSequence += [pscustomobject]@{
          type = $focusType
          name = $focusName
        }
      } catch {}
      [System.Windows.Forms.SendKeys]::SendWait('{TAB}')
      Start-Sleep -Milliseconds 80
    }
    $nativeInteractive = @()
    $nativeUnnamed = @()
    $nativeLabels = @()
    foreach ($node in $saveDialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
      try { $current = $node.Current } catch { continue }
      if ($null -eq $current -or $null -eq $current.ControlType) { continue }
      $type = $current.ControlType.ProgrammaticName.Replace('ControlType.', '')
      $name = [string]$current.Name
      if ($type -in @('Button', 'SplitButton', 'Edit', 'ComboBox', 'CheckBox', 'RadioButton', 'TabItem', 'ListItem', 'Hyperlink', 'MenuItem')) {
        $nativeInteractive += [pscustomobject]@{ type = $type; name = $name; element = $node }
        if ([string]::IsNullOrWhiteSpace($name)) { $nativeUnnamed += $type }
      }
      if ($type -eq 'Text' -and $name -in @('File name:', 'Save as type:')) { $nativeLabels += $name }
    }
    $nativeButtons = @($nativeInteractive | Where-Object type -in @('Button', 'SplitButton'))
    $nativeFields = @($nativeInteractive | Where-Object type -in @('Edit', 'ComboBox', 'CheckBox', 'RadioButton') | ForEach-Object { [pscustomobject]@{ type = $_.type; name = $_.name } } | Select-Object -Unique)
    $cancelNames = @('Cancelar', 'Cancel')
    $saveNames = @('Guardar', 'Save')
    $cancelElement = $null
    foreach ($button in $nativeButtons) {
      if ($button.name -in $cancelNames) { $cancelElement = $button.element; break }
    }
    $saveAvailable = @($nativeButtons | Where-Object { $_.name -in $saveNames }).Count -gt 0
    $keyboardCancelReachable = @($keyboardFocusSequence | Where-Object { $_.name -in $cancelNames }).Count -gt 0
    $keyboardSaveReachable = @($keyboardFocusSequence | Where-Object { $_.name -in $saveNames }).Count -gt 0
    $nativeSaveDialog = [pscustomobject]@{
      appearedInWindowsUiAutomation = $true
      title = $saveDialog.Current.Name
      interactiveControls = $nativeInteractive.Count
      unnamedInteractiveControls = $nativeUnnamed.Count
      buttons = @($nativeButtons | ForEach-Object name | Select-Object -Unique)
      fields = $nativeFields
      labels = @($nativeLabels | Select-Object -Unique)
      cancelButtonAvailable = $null -ne $cancelElement
      saveButtonAvailable = $saveAvailable
      closedWithCancel = $false
      closeMethod = $null
      keyboardCancelActivated = $false
      keyboardCancelReachable = $keyboardCancelReachable
      keyboardSaveReachable = $keyboardSaveReachable
      keyboardFocusSequence = @($keyboardFocusSequence | Where-Object { $_.name -in @('Save', 'Cancel', 'Save as type:', 'QA resume - QA employer - QA analyst') } | Select-Object -Property type, name -Unique)
      desktopTopLevelWindows = $desktopWindowNames
      processWindowCandidates = @($nativeWindowCandidates | Select-Object -Unique)
      processId = $saveDialog.Current.ProcessId
      className = $saveDialog.Current.ClassName
      frameworkId = $saveDialog.Current.FrameworkId
    }
    if ($null -ne $cancelElement) {
      $cancelElement.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      $nativeSaveDialog.closeMethod = 'accessible-cancel-button'
    } else {
      for ($tabIndex = 0; $tabIndex -lt 32 -and -not $nativeSaveDialog.keyboardCancelActivated; $tabIndex++) {
        try {
          $focusedElement = [System.Windows.Automation.AutomationElement]::FocusedElement
          $focusedName = [string]$focusedElement.Current.Name
        } catch { $focusedName = '' }
        if ($focusedName -in @('Cancel', 'Cancelar')) {
          [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
          $nativeSaveDialog.keyboardCancelActivated = $true
          $nativeSaveDialog.closeMethod = 'keyboard-enter-on-cancel'
          break
        }
        [System.Windows.Forms.SendKeys]::SendWait('{TAB}')
        Start-Sleep -Milliseconds 80
      }
      if (-not $nativeSaveDialog.keyboardCancelActivated) {
        try { $saveDialog.SetFocus() } catch {}
        [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
        $nativeSaveDialog.closeMethod = 'Escape'
      }
    }
    $closeDeadline = (Get-Date).AddSeconds(8)
    while ((Get-Date) -lt $closeDeadline) {
      Start-Sleep -Milliseconds 200
      $stillOpen = $false
      try {
        $desktopDescendants = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($desktopWindow in $desktopDescendants) {
          try { $current = $desktopWindow.Current } catch { continue }
          if ($null -ne $current -and $current.ControlType.ProgrammaticName -eq 'ControlType.Window' -and $current.Name -eq 'Guardar copia del CV') { $stillOpen = $true; break }
        }
      } catch { $stillOpen = $false }
      if (-not $stillOpen) { $nativeSaveDialog.closedWithCancel = $true; break }
    }
  }

  $failed = @()
  $sourceButtons = @($screens | Where-Object { $_.screen -eq 'Fuentes' } | ForEach-Object { $_.buttons })
  $profileDialogFields = @($dialogs | Where-Object { $_.dialog -eq 'Nueva búsqueda' } | ForEach-Object { $_.fields | ForEach-Object name })
  foreach ($requiredProfileField in @('Sueldo mínimo mensual', 'Días remunerados por semana', 'Horas remuneradas por semana', 'Exigir coincidencia del horario', 'Exigir que el sueldo publicado alcance el mínimo')) {
    if (-not ($profileDialogFields | Where-Object { $_ -like "$requiredProfileField*" })) {
      $failed += "Profile field is not exposed to UI Automation: $requiredProfileField"
    }
  }
  $authorizeActions = @($sourceButtons | Where-Object { $_ -like 'Autorizar consultas automáticas para QA pending feed' })
  $revokeActions = @($sourceButtons | Where-Object { $_ -like 'Revocar*QA approved paused feed' })
  if ($authorizeActions.Count -ne 1) { $failed += 'The pending custom feed does not expose its authorization button to UI Automation' }
  if ($revokeActions.Count -ne 1) { $failed += 'The authorized paused feed does not expose its revocation button to UI Automation' }
  $cvUploadLabels = @($screens | Where-Object { $_.screen -eq 'Mis CV' } | ForEach-Object { $_.buttons } | Where-Object { $_ -like 'Cargar CV:*' -or $_ -like 'Elegir archivos:*' })
  if ($cvUploadLabels.Count -ne 2 -or @($cvUploadLabels | Where-Object { $_ -notmatch ': Sin archivos seleccionados$' }).Count -gt 0) {
    $failed += 'PDF upload controls are not localized to Spanish'
  }
  $settingsButtons = @($screens | Where-Object { $_.screen -eq 'Preferencias' } | ForEach-Object { $_.buttons })
  if ($settingsButtons -notcontains 'Actualizar cotizaciones') {
    $failed += 'BCRA salary exchange rate refresh is not exposed in Preferences'
  }
  foreach ($screen in $screens) { if ($screen.unnamedInteractiveControls -gt 0) { $failed += "Unnamed control on $($screen.screen)" } }
  foreach ($label in $expectedMenus) { if ($menuLabels -notcontains $label) { $failed += "Localized native menu is missing: $label" } }
  foreach ($label in $englishMenuLabels) { $failed += "Default English menu is visible: $label" }
  foreach ($dialog in $dialogs) {
    if (-not $dialog.appearedInWindowsUiAutomation) { $failed += "Dialog not exposed: $($dialog.dialog)" }
    if ($dialog.unnamedInteractiveControls -gt 0) { $failed += "Unnamed control in $($dialog.dialog)" }
    if (-not $dialog.focusOnFormControl) { $failed += "No focused form control in $($dialog.dialog)" }
    if (-not $dialog.closedWithCancel -or -not $dialog.navigationRestored) { $failed += "Dialog did not close cleanly: $($dialog.dialog)" }
  }
  if (-not $nativeSaveDialog.appearedInWindowsUiAutomation) { $failed += 'Native Save As dialog was not exposed to Windows UI Automation' }
  if (-not $nativeSaveDialog.cancelButtonAvailable -and -not $nativeSaveDialog.keyboardCancelReachable) { $failed += 'Native Save As dialog did not expose Cancel to UI Automation or keyboard focus' }
  if (-not $nativeSaveDialog.closedWithCancel) { $failed += 'Native Save As dialog did not close with cancellation' }
  if (-not $nativeSaveDialog.saveButtonAvailable -and -not $nativeSaveDialog.keyboardSaveReachable) { $failed += 'Native Save As dialog did not expose a named Save control to UI Automation or keyboard focus' }
  if ($nativeSaveDialog.unnamedInteractiveControls -gt 0) { $failed += 'Native Save As dialog contains unnamed interactive controls' }

  $report = [pscustomobject]@{
    version = $Version
    method = 'Windows UI Automation API on packaged executable; isolated synthetic profile'
    startupRendererTimeoutSeconds = 60
    nativeMenuLabels = $menuLabels
    defaultEnglishMenuLabels = $englishMenuLabels
    cvUploadLabels = $cvUploadLabels
    sourceAutomationActions = [pscustomobject]@{ authorize = $authorizeActions; revoke = $revokeActions }
    screens = $screens
    dialogs = $dialogs
    nativeSaveDialog = $nativeSaveDialog
    result = if ($failed.Count -eq 0) { 'passed' } else { 'failed' }
    failures = $failed
    qaDirectory = $qaRoot.Substring($root.Length + 1)
  }
  $json = $report | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText((Join-Path $qaRoot 'QA-ACCESSIBILITY.json'), $json, [System.Text.UTF8Encoding]::new($false))
  if ($failed.Count -eq 0) {
    [System.IO.File]::WriteAllText((Join-Path $releaseRoot 'QA-ACCESSIBILITY.json'), $json, [System.Text.UTF8Encoding]::new($false))
  }
  $json
  if ($failed.Count -gt 0) { throw "Windows UI Automation smoke found $($failed.Count) issue(s). See $qaRoot" }
} finally {
  $app.Refresh()
  if (-not $app.HasExited) {
    & taskkill.exe /PID $app.Id /T /F | Out-Null
    try { $app.WaitForExit() } catch {}
  }
}

