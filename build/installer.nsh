; Custom NSIS include picked up automatically by electron-builder (default path
; build/installer.nsh). We use it to install the Microsoft Visual C++
; Redistributable (x64, 2015-2022) at install time when missing — required by
; onnxruntime-node's native binding (loads vcruntime140.dll / msvcp140.dll),
; which fails to load on a clean Windows install.

!macro customInstall
  ; The 14.x runtimes (VC++ 2015/2017/2019/2022) share one registry key. Any
  ; of them being installed satisfies our dependency, so we just check the key.
  ; SetRegView 64 is required: a 32-bit NSIS installer would otherwise get
  ; redirected to WOW6432Node and read the wrong value.
  SetRegView 64
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  SetRegView default

  ${If} $0 <> 1
    DetailPrint "Installazione Microsoft Visual C++ Redistributable (dipendenza richiesta)..."
    SetOutPath "$PLUGINSDIR"
    File "${BUILD_RESOURCES_DIR}\vc_redist.x64.exe"
    ; /install /quiet /norestart: no UI, no reboot. Windows will still show a
    ; UAC prompt because vc_redist writes to system dirs (we're a per-user
    ; installer, so we don't inherit elevation).
    ExecWait '"$PLUGINSDIR\vc_redist.x64.exe" /install /quiet /norestart' $1
    ; Exit codes we treat as success:
    ;   0    = installed
    ;   1638 = a newer version is already installed
    ;   3010 = success but reboot required (harmless for us)
    ${If} $1 <> 0
    ${AndIf} $1 <> 1638
    ${AndIf} $1 <> 3010
      DetailPrint "AVVISO: installazione VC++ Redistributable non riuscita (codice $1). Se l'app non parte, installalo manualmente da https://aka.ms/vs/17/release/vc_redist.x64.exe"
    ${EndIf}
  ${EndIf}
!macroend
