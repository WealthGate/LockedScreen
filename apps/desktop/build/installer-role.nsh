!include LogicLib.nsh
!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
Var LockedscreenInstallRole
Var LockedscreenIsUpdate
Var LockedscreenTeacherRadio
Var LockedscreenStudentRadio
Var LockedscreenServiceResult

!macro customInit
  StrCpy $LockedscreenIsUpdate "0"
  ${GetParameters} $R0
  ${GetOptions} $R0 "--updated" $R1
  ${IfNot} ${Errors}
    StrCpy $LockedscreenIsUpdate "1"
  ${EndIf}

  ${If} $LockedscreenIsUpdate == "1"
    StrCpy $LockedscreenInstallRole "teacher"
    IfFileExists "$INSTDIR\resources\install-role.json" 0 roleDone
      FileOpen $0 "$INSTDIR\resources\install-role.json" r
      FileRead $0 $1
      FileClose $0
      StrCmp $1 '{"role":"student"}' 0 roleDone
        StrCpy $LockedscreenInstallRole "student"
  roleDone:
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Page custom LockedscreenRolePageCreate LockedscreenRolePageLeave
!macroend

Function LockedscreenRolePageCreate
  ${If} $LockedscreenIsUpdate == "1"
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 32u "Choose how this device will use Lockedscreen. If Windows asks for administrator approval, a parent, guardian, or administrator should click Yes or enter the admin password so Full Kiosk Mode can be installed."
  Pop $0
  ${NSD_CreateRadioButton} 0 42u 100% 18u "Student - exam launch and student submission only"
  Pop $LockedscreenStudentRadio
  ${NSD_CreateRadioButton} 0 66u 100% 18u "Teacher / School - full setup, imports, packages, results, and LMS connections"
  Pop $LockedscreenTeacherRadio
  ${NSD_CreateLabel} 0 94u 100% 34u "The installer will automatically install and start the Lockedscreen Security Service. After setup, students can start Full Kiosk exams without teacher-side device setup."
  Pop $0
  ${NSD_Check} $LockedscreenStudentRadio
  StrCpy $LockedscreenInstallRole "student"

  nsDialogs::Show
FunctionEnd

Function LockedscreenRolePageLeave
  ${NSD_GetState} $LockedscreenStudentRadio $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $LockedscreenInstallRole "student"
  ${Else}
    StrCpy $LockedscreenInstallRole "teacher"
  ${EndIf}
FunctionEnd

!macro customInstall
  ${If} $LockedscreenInstallRole == ""
    StrCpy $LockedscreenInstallRole "teacher"
  ${EndIf}

  CreateDirectory "$INSTDIR\resources"
  FileOpen $0 "$INSTDIR\resources\install-role.json" w
  FileWrite $0 '{"role":"$LockedscreenInstallRole"}'
  FileClose $0

  IfFileExists "$INSTDIR\resources\lockedscreen-security\service\Lockedscreen.Security.Service.exe" 0 serviceMissing
    nsExec::ExecToLog '"$SYSDIR\sc.exe" stop LockedscreenSecurityService'
    Pop $LockedscreenServiceResult
    nsExec::ExecToLog '"$SYSDIR\sc.exe" delete LockedscreenSecurityService'
    Pop $LockedscreenServiceResult
    nsExec::ExecToLog '"$SYSDIR\sc.exe" create LockedscreenSecurityService binPath= "$INSTDIR\resources\lockedscreen-security\service\Lockedscreen.Security.Service.exe" start= auto DisplayName= "Lockedscreen Security Service"'
    Pop $LockedscreenServiceResult
    ${If} $LockedscreenServiceResult != 0
      MessageBox MB_ICONSTOP "Lockedscreen could not install the Security Service. A parent, guardian, teacher, or administrator must approve the Windows administrator prompt. Run the standard Setup installer again and click Yes when Windows asks for permission."
      Abort
    ${EndIf}
    nsExec::ExecToLog '"$SYSDIR\sc.exe" description LockedscreenSecurityService "Provides the Lockedscreen native security companion service for secure exam sessions."'
    Pop $LockedscreenServiceResult
    nsExec::ExecToLog '"$SYSDIR\sc.exe" start LockedscreenSecurityService'
    Pop $LockedscreenServiceResult
    ${If} $LockedscreenServiceResult != 0
      MessageBox MB_ICONSTOP "Lockedscreen installed but could not start the Security Service. Restart Windows, then run the standard Setup installer again as administrator."
      Abort
    ${EndIf}
    Goto serviceDone
  serviceMissing:
    MessageBox MB_ICONSTOP "Lockedscreen could not find the native Security Service files in this installer. Download and run the standard Lockedscreen Setup installer, not the portable app."
    Abort
  serviceDone:
!macroend
!endif

!macro customUnInstall
  nsExec::ExecToLog '"$SYSDIR\sc.exe" stop LockedscreenSecurityService'
  nsExec::ExecToLog '"$SYSDIR\sc.exe" delete LockedscreenSecurityService'
!macroend
