!macro customUnInstall
  ExecWait '"$SYSDIR\schtasks.exe" /end /tn "RadarLaboral-ar.radarlaboral.desktop-BackgroundSearch"' $0
  ExecWait '"$SYSDIR\schtasks.exe" /delete /tn "RadarLaboral-ar.radarlaboral.desktop-BackgroundSearch" /f' $0
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ar.radarlaboral.desktop"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "ar.radarlaboral.desktop"
!macroend
