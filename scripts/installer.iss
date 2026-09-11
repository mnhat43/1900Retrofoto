; Kich ban Inno Setup - bien dich thanh 1900Retrofoto-Setup.exe
;
; Cach dung:
;   1. Chay:  powershell -ExecutionPolicy Bypass -File scripts\package-app.ps1
;   2. Cai Inno Setup: https://jrsoftware.org/isdl.php
;   3. Mo file nay bang Inno Setup, bam Build > Compile
;
; Ket qua: build\1900Retrofoto-Setup.exe - chep sang may khac, nhap dup la cai duoc.

#define AppName "1900 Retrofoto"
; PHAI khop 2 so dau cua "version" trong package.json - package-app.ps1
; kiem tra va tu choi dong goi neu lech.
#define AppVersion "1.3"
#define AppPublisher "1900 Retrofoto"

[Setup]
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\1900Retrofoto
DefaultGroupName={#AppName}
OutputDir=..\build
OutputBaseFilename=1900Retrofoto-Setup
Compression=lzma2/max
SolidCompression=yes
; Can quyen Admin de mo firewall va dang ky tu chay khi bat may
PrivilegesRequired=admin
DisableProgramGroupPage=yes
WizardStyle=modern
; Anh huong toi kich thuoc file cai - goi ~113MB nen con khoang 45MB
LZMAUseSeparateProcess=yes

[Languages]
Name: "vi"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\build\1900Retrofoto\*"; DestDir: "{app}"; \
  Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Trang quan ly"; Filename: "{app}\Mo-trang-quan-ly.cmd"
Name: "{group}\KIEM TRA (chay khi co van de)"; Filename: "{app}\KIEM-TRA.bat"
Name: "{group}\Khoi dong lai"; Filename: "{app}\KHOI-DONG-LAI.bat"
Name: "{group}\Sua dia chi IP"; Filename: "{app}\SUA-IP.bat"
Name: "{group}\Ghim IP co dinh"; Filename: "{app}\DAT-IP-TINH.bat"
Name: "{group}\Chay server"; Filename: "{app}\Chay-server.cmd"
Name: "{group}\Cai dat lai"; Filename: "{app}\CAI-DAT.bat"
Name: "{group}\Go cai dat"; Filename: "{uninstallexe}"

[Run]
; Sau khi chep file xong thi mo trinh cai dat co giao dien
Filename: "{app}\CAI-DAT.bat"; \
  Description: "Cau hinh va khoi dong ngay"; \
  Flags: postinstall shellexec

[UninstallRun]
; Don sach khi go: bo ca hai tac vu va rule firewall
Filename: "schtasks"; Parameters: "/Delete /TN 1900Retrofoto /F"; \
  Flags: runhidden; RunOnceId: "RemoveTask"
Filename: "schtasks"; Parameters: "/Delete /TN 1900Retrofoto-TheoDoi /F"; \
  Flags: runhidden; RunOnceId: "RemoveWatchTask"
Filename: "powershell"; \
  Parameters: "-NoProfile -Command ""Remove-NetFirewallRule -DisplayName '1900 Retrofoto' -ErrorAction SilentlyContinue"""; \
  Flags: runhidden; RunOnceId: "RemoveFirewall"

[UninstallDelete]
; Xoa file cau hinh va log, NHUNG KHONG dong vao thu muc anh khach
Type: files; Name: "{app}\.env.local"
Type: filesandordirs; Name: "{app}\logs"
