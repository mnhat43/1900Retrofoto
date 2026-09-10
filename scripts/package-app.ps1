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
if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
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
# Chi cai dependencies (khong co devDependencies) de goi nho lai
Write-Host "  Dang cai thu vien (vai phut)..."
Push-Location $OutDir
& $nodeExe (Join-Path (Split-Path $nodeExe) "node_modules\npm\bin\npm-cli.js") `
  install --omit=dev --no-audit --no-fund 2>&1 | Out-Null
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

# --- 7. File khoi dong ---
# Dung node.exe nhung san, khong phu thuoc PATH cua may dich
@'
@echo off
cd /d "%~dp0"
if not exist ".env.local" (
  echo Chua cau hinh. Nhap dup CAI-DAT.bat truoc.
  pause
  exit /b 1
)
runtime\node.exe --experimental-strip-types --disable-warning=ExperimentalWarning server\index.ts
pause
'@ | Set-Content (Join-Path $OutDir "Chay-server.cmd") -Encoding ASCII

Write-Host "  [ok] Da tao Chay-server.cmd"

# --- 8. Trinh cai dat co giao dien ---
Copy-Item (Join-Path $PSScriptRoot "setup-gui.ps1") $OutDir -Force
@'
@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-gui.ps1"
'@ | Set-Content (Join-Path $OutDir "CAI-DAT.bat") -Encoding ASCII

Write-Host "  [ok] Da tao CAI-DAT.bat"

# --- 9. Loi tat mo trang quan ly ---
# Doc IP va cong tu .env.local luc chay, khong ghi cung vao file
@'
@echo off
cd /d "%~dp0"
for /f "tokens=2 delims==" %%a in ('findstr /b PHOTOBOOTH_PORT .env.local') do set PORT=%%a
if "%PORT%"=="" set PORT=8090
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  set IP=%%a
  goto :found
)
:found
set IP=%IP: =%
start http://%IP%:%PORT%/staff
'@ | Set-Content (Join-Path $OutDir "Mo-trang-quan-ly.cmd") -Encoding ASCII

Write-Host "  [ok] Da tao Mo-trang-quan-ly.cmd"

# --- 10. Huong dan ngan de canh file cai ---
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
