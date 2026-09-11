# Dong goi thanh mot thu muc chay duoc ngay, khong can cai Node.js
#
# Ket qua: build\1900Retrofoto\  -> nen lai thanh ZIP hoac dung Inno Setup
# de tao file .exe cai dat.
#
#   powershell -ExecutionPolicy Bypass -File scripts\package-app.ps1

$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $PSScriptRoot
$OutDir = Join-Path $AppDir "build\1900Retrofoto"

Write-Host ""
Write-Host "  Dong goi 1900 Retrofoto" -ForegroundColor Cyan
Write-Host ""

# --- 1. Kiem tra Node tren may dang dong goi ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "  Can Node.js de dong goi. Tai o https://nodejs.org" -ForegroundColor Red
  exit 1
}
$nodeExe = $node.Source
$ver = (node -v) -replace 'v(\d+).*', '$1'
if ([int]$ver -lt 22) {
  Write-Host "  Can Node.js 22 tro len (dang co $(node -v))." -ForegroundColor Red
  exit 1
}
Write-Host "  [ok] Node.js $(node -v)"

<#
  Phien ban phai khop giua package.json va installer.iss.

  Tu khi CAP-NHAT so package.json cua may voi tag tren GitHub de quyet dinh
  co cap nhat hay khong, quen bump package.json la moi may ngoai quan ket
  o ban cu VINH VIEN ma khong bao gi - no chi lang le noi "dang dung ban moi
  nhat". Chan ngay tai khau dong goi.
#>
$pkgVersion = (Get-Content (Join-Path $AppDir "package.json") -Raw | ConvertFrom-Json).version
if (-not $pkgVersion -or $pkgVersion -eq "0.0.0") {
  Write-Host "  package.json chua co so phien ban that (dang la '$pkgVersion')." -ForegroundColor Red
  exit 1
}
$issPath = Join-Path $PSScriptRoot "installer.iss"
$issMatch = Select-String -Path $issPath -Pattern '#define AppVersion "([^"]+)"'
$issVersion = $issMatch.Matches[0].Groups[1].Value
# installer.iss dung kieu "1.2", package.json dung "1.2.0" -> so 2 so dau
if ($issVersion -ne ($pkgVersion -replace '^(\d+\.\d+).*', '$1')) {
  Write-Host "  Lech phien ban: package.json=$pkgVersion nhung installer.iss=$issVersion" -ForegroundColor Red
  Write-Host "  Sua cho khop roi dong goi lai." -ForegroundColor Red
  exit 1
}
Write-Host "  [ok] Phien ban $pkgVersion"

# --- 2. Build giao dien ---
Write-Host "  Dang build giao dien..."
Push-Location $AppDir
npm run build 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Pop-Location
  Write-Host "  Build that bai. Chay 'npm run build' de xem loi." -ForegroundColor Red
  exit 1
}
Pop-Location
Write-Host "  [ok] Da build giao dien"

# --- 3. Don thu muc dich ---
<#
  Xoa NOI DUNG chu khong xoa ca thu muc.

  Chi can mot cua so Explorer hay mot terminal dang dung o $OutDir la Windows
  khoa CHINH thu muc do (khoa thu muc lam viec, khong phai khoa file) - luc do
  'Remove-Item $OutDir' that bai va ca lan dong goi hong. File ben trong thi
  van xoa duoc binh thuong.

  Muc tieu that su la "khong con file thua cua lan truoc", khong phai "thu muc
  bien mat" - nen lam theo cach khong bao gio vuong khoa nay.
#>
if (Test-Path $OutDir) {
  Get-ChildItem $OutDir -Force | Remove-Item -Recurse -Force
}
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

# --- 4. Chep ma nguon va tai nguyen ---
foreach ($d in @("server", "src", "dist", "public", "agent")) {
  Copy-Item (Join-Path $AppDir $d) (Join-Path $OutDir $d) -Recurse -Force
}
# Bo file test - khong can khi chay that
Get-ChildItem $OutDir -Recurse -Include "*.test.ts" | Remove-Item -Force
Copy-Item (Join-Path $AppDir "package.json") $OutDir -Force
foreach ($f in @("room.html", "staff.html", "studio.html")) {
  Copy-Item (Join-Path $AppDir $f) $OutDir -Force
}
Write-Host "  [ok] Da chep ma nguon"

# --- 5. Nhung Node runtime ---
# Nho vay may dich KHONG can cai Node.js
New-Item -ItemType Directory -Path (Join-Path $OutDir "runtime") -Force | Out-Null
Copy-Item $nodeExe (Join-Path $OutDir "runtime\node.exe") -Force
Write-Host "  [ok] Da nhung Node runtime"

# --- 6. Cai thu vien can khi chay ---
#
# Dung 'npm ci' voi package-lock.json chu khong 'npm install':
#   - Deterministic: goi dong hom nay va goi dong thang sau giong het nhau,
#     nen loi chi xay ra tren may quan thi con tai hien lai duoc.
#   - Nhanh hon nhieu (vai giay thay vi vai phut).
#   - 'npm install' khong co lock tren cay da bi cat devDependencies con hay
#     bao loi "Cannot read properties of null (reading 'edgesOut')".
Write-Host "  Dang cai thu vien..."
Copy-Item (Join-Path $AppDir "package-lock.json") $OutDir -Force
Push-Location $OutDir
& $nodeExe (Join-Path (Split-Path $nodeExe) "node_modules\npm\bin\npm-cli.js") `
  ci --omit=dev --no-audit --no-fund 2>&1 | Out-Null
$npmOk = $LASTEXITCODE -eq 0
Pop-Location
if (-not $npmOk) {
  Write-Host "  Cai thu vien that bai." -ForegroundColor Red
  exit 1
}
# react/react-dom chi dung luc build, khong can khi chay
foreach ($m in @("react", "react-dom")) {
  $path = Join-Path $OutDir "node_modules\$m"
  if (Test-Path $path) { Remove-Item $path -Recurse -Force }
}
Write-Host "  [ok] Da cai thu vien"

<#
  Ghi file .bat / .cmd voi kieu xuong dong CRLF.

  BAT BUOC phai CRLF: cmd.exe xu ly sai nhan (:label) va cac khoi nhieu dong
  khi file chi co LF - dung kieu loi chay duoc tren may nay ma hong tren may
  khac. 'Set-Content' voi MOT chuoi nhieu dong ghi y nguyen chuoi do (giu LF),
  nen phai tach thanh mang tung dong truoc: Set-Content nhan mang thi tu them
  xuong dong cua he thong (CRLF tren Windows) sau moi phan tu.
#>
function Write-BatFile([string]$Path, [string]$Text) {
  Set-Content -Path $Path -Value ($Text -split "\r?\n") -Encoding ASCII
}

# --- 7. Script PowerShell dung chung ---
# lib-net.ps1 phai di kem: cac script khac dot-source no
foreach ($s in @(
    "lib-net.ps1", "setup-gui.ps1", "theo-doi.ps1",
    "kiem-tra.ps1", "sua-ip.ps1", "dat-ip-tinh.ps1", "khoi-dong-lai.ps1",
    "cap-nhat.ps1", "go-cai-dat.ps1"
  )) {
  Copy-Item (Join-Path $PSScriptRoot $s) $OutDir -Force
}
Write-Host "  [ok] Da chep script cai dat va sua chua"

# --- 8. File khoi dong ---
#
# Co HAI ban, va su khac nhau la quan trong:
#
#   Chay-server.cmd          - nhan vien nhap dup. Co 'pause' de con doc
#                              duoc loi truoc khi cua so dong.
#   Chay-server-am-tham.cmd  - Task Scheduler chay. TUYET DOI KHONG co
#                              'pause': tac vu chay quyen SYSTEM, khong co ai
#                              bam phim, nen 'pause' se treo mai mai. Khi do
#                              Windows van thay tac vu "dang chay" va co che
#                              tu bat lai khong bao gio kich hoat duoc.
@'
@echo off
cd /d "%~dp0"
if not exist ".env.local" (
  echo Chua cau hinh. Chuot phai vao CAI-DAT.bat, chon Run as administrator.
  pause
  exit /b 1
)
runtime\node.exe --experimental-strip-types --disable-warning=ExperimentalWarning server\index.ts
pause
'@ | ForEach-Object { Write-BatFile (Join-Path $OutDir "Chay-server.cmd") $_ }

# Ghi de log moi lan chay (khong noi them): can biet vi sao LAN CUOI khong
# len, chu khong can lich su ca thang.
@'
@echo off
cd /d "%~dp0"
rem chcp 65001 = UTF-8, de log khong bi loi font khi server in chu co dau
chcp 65001 >nul 2>&1
if not exist ".env.local" exit /b 1
if not exist "logs" mkdir "logs"
runtime\node.exe --experimental-strip-types --disable-warning=ExperimentalWarning server\index.ts > "logs\lan-chay-cuoi.log" 2>&1
'@ | ForEach-Object { Write-BatFile (Join-Path $OutDir "Chay-server-am-tham.cmd") $_ }

Write-Host "  [ok] Da tao file khoi dong"

# --- 9. Cac file .bat cho nhan vien nhap dup ---
#
# Nhung viec can quyen Administrator thi TU XIN QUYEN (Start-Process -Verb
# RunAs) thay vi bat nhan vien nho chuot phai. Nho chuot phai la viec hay bi
# quen nhat, va khi quen thi script that bai mot cach kho hieu.
$elevated = @'
@echo off
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel%==0 goto run
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b
:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0__SCRIPT__"
'@

$plain = @'
@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0__SCRIPT__"
'@

# CAI-DAT.bat khong tu xin quyen: huong dan in ra va dan tren hop giay deu
# ghi "chuot phai -> Run as administrator", nen giu nguyen thao tac do de
# khong lech voi giay to da phat.
@'
@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-gui.ps1"
'@ | ForEach-Object { Write-BatFile (Join-Path $OutDir "CAI-DAT.bat") $_ }

foreach ($pair in @(
    @("KIEM-TRA.bat", "kiem-tra.ps1", $true),
    @("KHOI-DONG-LAI.bat", "khoi-dong-lai.ps1", $true),
    @("SUA-IP.bat", "sua-ip.ps1", $true),
    @("DAT-IP-TINH.bat", "dat-ip-tinh.ps1", $true),
    # Chay tu goi MOI vua giai nen, tro sang ban cu dang chay de thay file
    @("CAP-NHAT.bat", "cap-nhat.ps1", $true),
    @("GO-CAI-DAT.bat", "go-cai-dat.ps1", $true)
  )) {
  $tpl = if ($pair[2]) { $elevated } else { $plain }
  Write-BatFile (Join-Path $OutDir $pair[0]) $tpl.Replace('__SCRIPT__', $pair[1])
}
Write-Host "  [ok] Da tao KIEM-TRA / KHOI-DONG-LAI / SUA-IP / DAT-IP-TINH / CAP-NHAT / GO-CAI-DAT"

# --- 10. Loi tat mo trang quan ly ---
#
# Doc PHOTOBOOTH_HOST tu .env.local. Ban truoc doc IP bang cach loc ipconfig,
# va cach do lay dong IPv4 dau tien - tren may co WSL / VirtualBox thi do la
# card ao, mo ra trang trong. Cau hinh la nguon duy nhat dang tin.
#
# Dung goto chu khong long if trong ngoac: bien dat trong khoi ngoac khong
# duoc cap nhat ngay (chuyen kinh dien cua file .bat).
@'
@echo off
cd /d "%~dp0"
set HOSTPORT=
for /f "tokens=2 delims==" %%a in ('findstr /b PHOTOBOOTH_HOST .env.local') do set HOSTPORT=%%a
if not "%HOSTPORT%"=="" goto go
set PORT=8090
for /f "tokens=2 delims==" %%a in ('findstr /b PHOTOBOOTH_PORT .env.local') do set PORT=%%a
set HOSTPORT=127.0.0.1:%PORT%
:go
start "" http://%HOSTPORT%/staff
'@ | ForEach-Object { Write-BatFile (Join-Path $OutDir "Mo-trang-quan-ly.cmd") $_ }

Write-Host "  [ok] Da tao Mo-trang-quan-ly.cmd"

# --- 11. Huong dan de canh file cai ---
Copy-Item (Join-Path $AppDir "HUONG-DAN-CAI-DAT.md") (Join-Path $OutDir "HUONG-DAN.md") -Force
Copy-Item (Join-Path $PSScriptRoot "DOC-TRUOC.txt") (Join-Path $OutDir "DOC-TRUOC.txt") -Force
Write-Host "  [ok] Da chep huong dan"

$size = [math]::Round((Get-ChildItem $OutDir -Recurse | Measure-Object Length -Sum).Sum / 1MB)
Write-Host ""
Write-Host "  Xong. Thu muc: $OutDir  (~$size MB)" -ForegroundColor Green
Write-Host ""
Write-Host "  Buoc tiep theo:"
Write-Host "    - Nen thu muc tren thanh ZIP de chep sang may khac, HOAC"
Write-Host "    - Cai Inno Setup roi bien dich scripts\installer.iss thanh file .exe"
Write-Host ""
