; Register optional handlers without changing extension defaults or UserChoice.
!macro AnserRegisterMailType EXT
  WriteRegStr HKCU "Software\Classes\dev.maildesk.desktop.${EXT}" "" "${PRODUCTNAME} ${EXT}"
  WriteRegStr HKCU "Software\Classes\dev.maildesk.desktop.${EXT}\DefaultIcon" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0'
  WriteRegStr HKCU "Software\Classes\dev.maildesk.desktop.${EXT}\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr HKCU "Software\Classes\.${EXT}\OpenWithProgids" "dev.maildesk.desktop.${EXT}" ""
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""
  WriteRegStr HKCU "Software\Anser\Capabilities\FileAssociations" ".${EXT}" "dev.maildesk.desktop.${EXT}"
!macroend

!macro AnserUnregisterMailType EXT
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "dev.maildesk.desktop.${EXT}"
  DeleteRegKey /ifempty HKCU "Software\Classes\.${EXT}\OpenWithProgids"
  DeleteRegKey HKCU "Software\Classes\dev.maildesk.desktop.${EXT}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr HKCU "Software\Anser\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr HKCU "Software\Anser\Capabilities" "ApplicationDescription" "Anser mail client"
  WriteRegStr HKCU "Software\RegisteredApplications" "dev.maildesk.desktop" "Software\Anser\Capabilities"
  !insertmacro AnserRegisterMailType "eml"
  !insertmacro AnserRegisterMailType "emlx"
  !insertmacro AnserRegisterMailType "msg"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro AnserUnregisterMailType "eml"
  !insertmacro AnserUnregisterMailType "emlx"
  !insertmacro AnserUnregisterMailType "msg"
  DeleteRegKey HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  DeleteRegValue HKCU "Software\RegisteredApplications" "dev.maildesk.desktop"
  DeleteRegKey HKCU "Software\Anser\Capabilities"
  DeleteRegKey /ifempty HKCU "Software\Anser"
!macroend
