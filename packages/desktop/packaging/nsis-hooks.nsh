; Windows NSIS only (electron-builder nsis.include).
;
; Filename must not be installer.nsh — that is the electron-builder
; extract/install template (`!include installer.nsh` in installSection.nsh).
; Do not nest !macro inside another macro (makensis: "can't define a macro
; inside a macro"). This file is included before installUtil.nsh, so defining
; customCheckAppRunning here replaces the default process check.
;
; -----------------------------------------------------------------------------
; Overwrite install on Windows
;
; "CCRelay cannot be closed" has two sources, and only one of them is the
; process check:
;
; 1) CHECK_APP_RUNNING — Win11 PowerShell matches processes by
;    Path.StartsWith($INSTDIR) and then shows a MessageBox. A tray app (and
;    its sqlite3 child) often still holds files when that check runs.
;    Replaced below (taskkill, no MessageBox).
;
; 2) uninstallOldVersion — runs the already-installed Uninstall.exe with /S.
;    Manual uninstall works because it is NOT silent, so it never runs the
;    check and takes the plain `RMDir /r $INSTDIR` path. With /S + --updated
;    the uninstaller instead renames every file into $PLUGINSDIR\old-install
;    and Aborts if any single file is busy. On failure electron-builder retries
;    five times and then shows $(appCannotBeClosed) from the INSTALLER.
;
; So we do the uninstall ourselves, before that macro runs: extract this
; package's uninstaller and run it silently without --updated (plain RMDir
; path), then drop UninstallString and force-clear $INSTDIR. With
; UninstallString gone, uninstallOldVersion returns immediately and can no
; longer show the dialog, whatever the old uninstaller did.
;
; User data (~/.ccrelay and %APPDATA%\CCRelay) is outside $INSTDIR and is
; never touched: deleteAppDataOnUninstall is not enabled, so
; DELETE_APP_DATA_ON_UNINSTALL is undefined and the uninstall section keeps
; app data regardless of --updated.
;
; One-click installer: do not define customInstallMode. $isForceCurrentInstall
; exists only in the assisted installer, and referencing it fails makensis.
; -----------------------------------------------------------------------------

!macro customCheckAppRunning
  ; $TEMP, not $PLUGINSDIR: valid in the uninstaller too, where the plugins
  ; dir may not be initialised yet. Must leave $INSTDIR (set as cwd by
  ; .onInit) or nothing in it can be deleted.
  SetOutPath $TEMP

  nsExec::ExecToLog `taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T`
  Pop $0
  Sleep 500

  !ifndef BUILD_UNINSTALLER
    ${if} ${FileExists} "$INSTDIR\${UNINSTALL_FILENAME}"
    ${orIf} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ${orIf} ${FileExists} "$INSTDIR\resources\app.asar"
      File "/oname=$PLUGINSDIR\old-uninstaller-eb.exe" "${UNINSTALLER_OUT_FILE}"
      ExecWait '"$PLUGINSDIR\old-uninstaller-eb.exe" /S /currentuser _?=$INSTDIR' $0
      DetailPrint "Previous version uninstalled (exit code $0)."

      ; Backstop: whatever the uninstaller managed to do, leave no stale files.
      SetOutPath $TEMP
      RMDir /r "$INSTDIR"
      CreateDirectory "$INSTDIR"
      ClearErrors

      ; uninstallOldVersion must not run the old uninstaller again.
      DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
      DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
      DeleteRegValue HKLM "${UNINSTALL_REGISTRY_KEY}" UninstallString
      !ifdef UNINSTALL_REGISTRY_KEY_2
        DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
        DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
        DeleteRegValue HKLM "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
      !endif
      ClearErrors
    ${endIf}
  !endif
!macroend

; Never abort the install because the old uninstaller reported a failure.
!macro customUnInstallCheck
  ClearErrors
  StrCpy $R0 0
!macroend

!macro customUnInstallCheckCurrentUser
  ClearErrors
  StrCpy $R0 0
!macroend

; Auto-update: electron-updater always passes --updated. Older clients do not
; pass /S, so force silent when the installer was launched as an update.
!macro preInit
  ${if} ${isUpdated}
    SetSilent silent
  ${endIf}
!macroend

!macro customInit
  ${if} ${isUpdated}
    SetSilent silent
  ${endIf}
!macroend
