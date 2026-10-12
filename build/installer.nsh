!ifndef BUILD_UNINSTALLER
!macro customInstallMode
  ; Older builds let a per-user install target Program Files, where it cannot
  ; replace the uninstaller without elevation. Migrate that install to the
  ; machine scope; electron-builder's NSIS flow requests UAC and removes the
  ; old per-user registration before writing the new files.
  ${If} $hasPerUserInstallation == "1"
    StrCpy $R0 "$PROGRAMFILES64"
    StrLen $R1 $R0
    StrCpy $R2 $perUserInstallationFolder $R1
    ${If} $R2 == $R0
      StrCpy $isForceMachineInstall "1"
    ${Else}
      StrCpy $R0 "$PROGRAMFILES32"
      StrLen $R1 $R0
      StrCpy $R2 $perUserInstallationFolder $R1
      ${If} $R2 == $R0
        StrCpy $isForceMachineInstall "1"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  ; Older releases start silent NSIS updates without --force-run. Reopen those
  ; updates here; newer releases request --force-run and are launched once by
  ; electron-builder's normal install section.
  ${If} ${isUpdated}
  ${AndIf} ${Silent}
  ${AndIfNot} ${isForceRun}
    HideWindow
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
  ${EndIf}
!macroend
!endif

!macro customUnInstall
  ExecWait '"$SYSDIR\schtasks.exe" /end /tn "RadarLaboral-ar.radarlaboral.desktop-BackgroundSearch"' $0
  ExecWait '"$SYSDIR\schtasks.exe" /delete /tn "RadarLaboral-ar.radarlaboral.desktop-BackgroundSearch" /f' $0
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ar.radarlaboral.desktop"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "ar.radarlaboral.desktop"
!macroend
