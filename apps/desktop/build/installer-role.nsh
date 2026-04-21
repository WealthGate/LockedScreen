!include LogicLib.nsh
!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
Var LockedscreenInstallRole
Var LockedscreenTeacherRadio
Var LockedscreenStudentRadio

!macro customPageAfterChangeDir
  Page custom LockedscreenRolePageCreate LockedscreenRolePageLeave
!macroend

Function LockedscreenRolePageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Choose how this device will use Lockedscreen."
  Pop $0
  ${NSD_CreateRadioButton} 0 34u 100% 18u "Teacher / School - full setup, imports, packages, results, and LMS connections"
  Pop $LockedscreenTeacherRadio
  ${NSD_CreateRadioButton} 0 58u 100% 18u "Student - exam launch and student submission only"
  Pop $LockedscreenStudentRadio
  ${NSD_Check} $LockedscreenTeacherRadio
  StrCpy $LockedscreenInstallRole "teacher"

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
  CreateDirectory "$INSTDIR\resources"
  FileOpen $0 "$INSTDIR\resources\install-role.json" w
  FileWrite $0 '{"role":"$LockedscreenInstallRole"}'
  FileClose $0
!macroend
!endif
