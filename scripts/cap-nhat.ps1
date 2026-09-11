# CAP-NHAT - chep ban moi de len ban dang chay, giu nguyen cau hinh va anh.
#
# Chay tu THU MUC MOI vua giai nen. Script tu tim ban cu dang chay o dau,
# dung server, thay file chuong trinh, roi bat lai.
#
# Giu lai:  .env.local (mat khau, cong, dia chi QR), logs\
# Khong dung toi: thu muc anh va database (nam ngoai, theo PHOTOBOOTH_DATA)
#
# Chi dung ASCII (khong dau) - console Windows khong hien duoc chu co dau.

param([string]$NewDir, [string]$OldDir)

. (Join-Path $PSScriptRoot 'lib-net.ps1')

if (-not $NewDir) { $NewDir = Resolve-AppDir $PSScriptRoot }

# Thieu mot trong nhung thu muc nay thi goi chua giai nen xong - chan tu dau
# thay vi thay nua chung roi de quan khong co server.
$CodeDirs = @('server', 'src', 'dist', 'public', 'agent', 'node_modules', 'runtime')

# Thu cua RIENG ban dang chay, khong duoc de ban moi de len.
$Keep = @('.env.local', 'logs')

function Say([string]$Text, [string]$Color = 'Gray') {
  Write-Host "  $Text" -ForegroundColor $Color
}

function Stop-Here([string]$Message) {
  Write-Host ""
  Say $Message 'Red'
  Write-Host ""
  Say 'Nhan Enter de dong cua so nay.'
  [void](Read-Host)
  exit 1
}

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host "    1900 RETROFOTO - CAP NHAT BAN MOI" -ForegroundColor Cyan
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host ""

# --- 1. Phai co quyen Administrator ---
#
# Dung/bat tac vu Windows va ghi de file dang bi khoa deu can quyen nay.
# CAP-NHAT.bat tu xin quyen roi, nen toi day ma van thieu la co chuyen la.
$isAdmin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Stop-Here 'Thieu quyen Administrator. Chuot phai CAP-NHAT.bat -> Run as administrator.'
}

# --- 2. Tim ban dang chay ---
#
# Nguon dang tin nhat la tac vu Windows: no tro thang vao file chay cua ban
# dang duoc cai, khong phai phong doan theo duong dan quen thuoc.
if (-not $OldDir) {
  $task = Get-ScheduledTask -TaskName (Get-TaskName) -ErrorAction SilentlyContinue
  if ($task) {
    $exec = @($task.Actions)[0].Execute
    if ($exec) { $OldDir = Split-Path -Parent $exec }
  }
}

# Chua dang ky tac vu (cai bang tay, hoac tac vu bi xoa) -> do cac cho quen
if (-not $OldDir) {
  foreach ($guess in @('C:\1900Retrofoto', 'D:\1900Retrofoto', 'E:\1900Retrofoto')) {
    if (Test-Path (Join-Path $guess '.env.local')) { $OldDir = $guess; break }
  }
}

if (-not $OldDir -or -not (Test-Path $OldDir)) {
  Stop-Here 'Khong tim thay ban dang chay. May nay hinh nhu chua cai lan nao -> chuot phai CAI-DAT.bat.'
}

$envPath = Join-Path $OldDir '.env.local'
if (-not (Test-Path $envPath)) {
  Stop-Here "Thu muc $OldDir chua co cau hinh (.env.local) -> day khong phai ban da cai. Chuot phai CAI-DAT.bat."
}

# Chay nham script trong chinh ban cu thi se tu xoa minh -> chan thang
if ((Resolve-Path $NewDir).Path -eq (Resolve-Path $OldDir).Path) {
  Stop-Here "Dang chay CAP-NHAT tu chinh ban cu ($OldDir). Hay giai nen ban MOI ra cho khac roi chay CAP-NHAT.bat trong do."
}

foreach ($d in $CodeDirs) {
  if (-not (Test-Path (Join-Path $NewDir $d))) {
    Stop-Here "Thu muc moi thieu '$d' -> giai nen chua xong hoac sai thu muc. Giai nen lai roi thu lai."
  }
}

$port = Get-ServerPort $OldDir

Say "Ban dang chay:  $OldDir" 'White'
Say "Ban moi:        $NewDir" 'White'
Write-Host ""
Say 'Cau hinh (mat khau, cong, dia chi QR) va toan bo anh khach se GIU NGUYEN.' 'Green'
Say 'Server se tat khoang 1-2 phut. Dung cap nhat khi con khach dang chup.' 'Yellow'
Write-Host ""
$ans = Read-Host "  Go 'c' roi Enter de cap nhat (Enter khong de huy)"
if ($ans -ne 'c') {
  Write-Host ""
  Say 'Da huy. Khong co gi thay doi.'
  Write-Host ""
  Say 'Nhan Enter de dong cua so nay.'
  [void](Read-Host)
  exit 0
}

# --- 3. Sao luu cau hinh TRUOC khi dung vao gi ---
#
# Mat .env.local la mat mat khau va dia chi in vao ma QR -> phai co ban sao
# nam ngoai thu muc sap bi ghi de, phong khi cap nhat dut giua chung.
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $env:TEMP "1900Retrofoto-env-$stamp.bak"
Copy-Item $envPath $backup -Force
Write-Host ""
Say "[ok] Da sao luu cau hinh: $backup" 'Green'

# --- 4. Dung server ---
#
# Dung ca hai tac vu truoc khi giet tien trinh: neu khong, tac vu chinh chay
# lai sau 5 phut hoac watchdog bat lai ngay giua luc dang chep file.
foreach ($t in @((Get-TaskName), (Get-WatchTaskName))) {
  cmd.exe /c "schtasks /End /TN $t >nul 2>&1"
  cmd.exe /c "schtasks /Change /TN $t /DISABLE >nul 2>&1"
}
$stopped = Stop-ServerProcess $OldDir
Start-Sleep -Seconds 2
# Con sot lai thi cho them - file dang mo se khong xoa duoc
if (@(Get-ServerProcess $OldDir).Count -gt 0) {
  Stop-ServerProcess $OldDir | Out-Null
  Start-Sleep -Seconds 3
}
Say "[ok] Da dung server ($stopped tien trinh)" 'Green'

# --- 5. Thay file chuong trinh ---
#
# Xoa thu muc dich TRUOC khi chep, tung cai mot:
#   - File thua cua ban cu (vi du dist\assets\*.js ten bam cu) khong don lai
#     qua tung lan cap nhat.
#   - 'Copy-Item -Recurse' vao mot thu muc DANG TON TAI se chep long vao ben
#     trong (dist\dist\...) chu khong ghi de - loi kinh dien cua PowerShell.
$failed = $null
try {
  foreach ($item in Get-ChildItem $NewDir -Force) {
    # $Keep la luoi an toan: goi khong bao gio nen chua .env.local, nhung neu
    # lo co thi no se de len cau hinh that cua quan.
    if ($Keep -contains $item.Name) { continue }
    $target = Join-Path $OldDir $item.Name
    if (Test-Path $target) { Remove-Item $target -Recurse -Force -ErrorAction Stop }
    Copy-Item $item.FullName $target -Recurse -Force -ErrorAction Stop
  }
} catch {
  $failed = $_.Exception.Message
}

if ($failed) {
  # Tra lai tac vu du that bai - khong de may o trang thai khong tu bat lai
  foreach ($t in @((Get-TaskName), (Get-WatchTaskName))) {
    cmd.exe /c "schtasks /Change /TN $t /ENABLE >nul 2>&1"
  }
  Stop-Here "Chep file that bai: $failed`n  Cau hinh van con o: $backup`n  Thu dong het cua so Explorer dang mo thu muc do roi chay lai."
}
Say '[ok] Da thay file chuong trinh' 'Green'

# --- 6. Tra lai cau hinh ---
#
# Buoc 5 co the da xoa .env.local neu ban moi tinh co cung ten file, nen
# chep lai tu ban sao thay vi tin rang no con nguyen.
Copy-Item $backup $envPath -Force
Say '[ok] Da giu nguyen cau hinh cu' 'Green'

# --- 7. Bat lai ---
foreach ($t in @((Get-TaskName), (Get-WatchTaskName))) {
  cmd.exe /c "schtasks /Change /TN $t /ENABLE >nul 2>&1"
}
Say 'Dang bat lai server...' 'Gray'
$how = Start-Server $OldDir
if ($how -eq 'none') {
  Stop-Here "Khong bat duoc server. Nhap dup KHOI-DONG-LAI.bat trong $OldDir."
}

# Lan chay dau sau khi cap nhat phai nap lai database -> cho toi 40 giay
Say 'Dang cho server san sang (toi 40 giay)...' 'Gray'
$health = $null
for ($i = 1; $i -le 20; $i++) {
  Start-Sleep -Seconds 2
  $health = Test-ServerHealth $port 3
  if ($health) { break }
}

Write-Host ""
if ($health) {
  Write-Host "  XONG. Da cap nhat va server dang chay." -ForegroundColor Green
  Write-Host ""
  Say 'Mo lai trang tren may nay va tren cac may trong phong chup:' 'White'
  Say "  Trang quan ly:  http://$($health.host)/staff"
  foreach ($r in $health.rooms) {
    Say "  Phong $r`:        http://$($health.host)/room?p=$r"
  }
  Write-Host ""
  Say 'Bam Ctrl + Shift + R o moi trang de trinh duyet nap giao dien moi.' 'Yellow'
} else {
  Write-Host "  DA THAY FILE NHUNG SERVER CHUA CHAY LAI DUOC." -ForegroundColor Red
  Write-Host ""
  Say "Nhap dup KIEM-TRA.bat trong $OldDir - no se chi ro dang vuong o dau." 'White'
  Say "Cau hinh cu con o: $backup" 'Gray'
}

Write-Host ""
Say 'Nhan Enter de dong cua so nay.'
[void](Read-Host)
