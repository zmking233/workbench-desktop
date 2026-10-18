!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "MUI2.nsh"

!ifndef BUILD_UNINSTALLER

Var DesktopShortcutCheckbox
Var DesktopShortcutChoice
Var InstallDirInput
Var InstallDirChoice
Var WorkspaceDirInput
Var WorkspaceDirChoice

!macro customPageAfterChangeDir
  Page custom InstallationDirectoryPage InstallationDirectoryPageLeave
  Page custom WorkspaceDirectoryPage WorkspaceDirectoryPageLeave
  Page custom DesktopShortcutPage DesktopShortcutPageLeave
!macroend

Function InstallationDirectoryPage
  !insertmacro MUI_HEADER_TEXT "安装目录" "选择“工作台”程序文件的安装位置。"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${If} $INSTDIR == ""
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\工作台"
  ${EndIf}
  StrCpy $InstallDirChoice "$INSTDIR"
  ${NSD_CreateLabel} 0 0 100% 28u "覆盖安装时也可以更换程序目录；工作区将在下一页单独选择。"
  Pop $0
  ${NSD_CreateDirRequest} 0 38u 78% 13u "$InstallDirChoice"
  Pop $InstallDirInput
  ${NSD_CreateBrowseButton} 80% 37u 20% 15u "浏览…"
  Pop $0
  ${NSD_OnClick} $0 InstallationDirectoryBrowse
  nsDialogs::Show
FunctionEnd

Function InstallationDirectoryBrowse
  ; Keep the nsDialogs plugin loaded while the Windows folder dialog worker is active.
  ; Without /NOUNLOAD, some Windows configurations close the worker before it returns.
  nsDialogs::SelectFolderDialog /NOUNLOAD "选择安装目录" "$InstallDirChoice"
  Pop $0
  ${If} $0 != error
  ${AndIf} $0 != ""
    StrCpy $InstallDirChoice "$0"
    ${NSD_SetText} $InstallDirInput "$InstallDirChoice"
  ${EndIf}
FunctionEnd

Function InstallationDirectoryPageLeave
  ${NSD_GetText} $InstallDirInput $InstallDirChoice
  ${If} $InstallDirChoice == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "请选择安装目录。"
    Abort
  ${EndIf}
  StrCpy $INSTDIR "$InstallDirChoice"
FunctionEnd

Function WorkspaceDirectoryPage
  !insertmacro MUI_HEADER_TEXT "工作目录" "选择工作区、Skill 和会话文件的保存位置。"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${If} $WorkspaceDirChoice == ""
    StrCpy $WorkspaceDirChoice "$DOCUMENTS\工作台工作区"
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 28u "工作目录与程序安装目录相互独立，卸载软件时默认保留其中的数据。"
  Pop $0

  ${NSD_CreateDirRequest} 0 38u 78% 13u "$WorkspaceDirChoice"
  Pop $WorkspaceDirInput

  ${NSD_CreateBrowseButton} 80% 37u 20% 15u "浏览…"
  Pop $0
  ${NSD_OnClick} $0 WorkspaceDirectoryBrowse

  nsDialogs::Show
FunctionEnd

Function WorkspaceDirectoryBrowse
  ; Keep the nsDialogs plugin loaded while the Windows folder dialog worker is active.
  nsDialogs::SelectFolderDialog /NOUNLOAD "选择工作目录" "$WorkspaceDirChoice"
  Pop $0
  ${If} $0 != error
  ${AndIf} $0 != ""
    StrCpy $WorkspaceDirChoice "$0"
    ${NSD_SetText} $WorkspaceDirInput "$WorkspaceDirChoice"
  ${EndIf}
FunctionEnd

Function WorkspaceDirectoryPageLeave
  ${NSD_GetText} $WorkspaceDirInput $WorkspaceDirChoice
  ${If} $WorkspaceDirChoice == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "请选择工作目录。"
    Abort
  ${EndIf}
  CreateDirectory "$WorkspaceDirChoice"
FunctionEnd

Function DesktopShortcutPage
  !insertmacro MUI_HEADER_TEXT "快捷方式" "选择安装完成后要创建的快捷方式。"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "请选择附加任务，然后单击“安装”继续。"
  Pop $0

  ${NSD_CreateCheckbox} 0 34u 100% 14u "创建桌面快捷方式"
  Pop $DesktopShortcutCheckbox
  ${NSD_Check} $DesktopShortcutCheckbox

  nsDialogs::Show
FunctionEnd

Function DesktopShortcutPageLeave
  ${NSD_GetState} $DesktopShortcutCheckbox $DesktopShortcutChoice
FunctionEnd

!macro customInstall
  CreateDirectory "$INSTDIR\resources"
  FileOpen $0 "$INSTDIR\resources\workspace-path.txt" w
  FileWrite $0 "$WorkspaceDirChoice"
  FileClose $0

  ${If} $DesktopShortcutChoice == ${BST_UNCHECKED}
    Delete "$newDesktopLink"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
!macroend

!endif
