# Cai dat Photo Booth Studio tren may chu Windows.
#
# Chay bang quyen Administrator:
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
#
# Script lam 3 viec:
#   1. Mo firewall cho cong 8080 (ca mang Private va Public)
#   2. Tao Scheduled Task de server tu chay khi khoi dong may
#   3. In ra dia chi de cau hinh PC cac phong
#
# Duong cai NAY danh cho nguoi co ma nguon. Nguoi khong biet code thi dung
# goi dong san (xem scripts\dong-goi.md) - goi do co CAI-DAT.bat lam nhieu
# viec hon: tat che do ngu, dat IP tinh, tu cuu khi server treo.
#
# LUU Y: file nay chi dung ky tu ASCII. Windows PowerShell 5.1 doc file
# UTF-8 khong BOM theo bang ma ANSI, lam vo chuoi co dau tieng Viet.

param(
  [int]$Port = 8080,
  [string]$DataDir = "D:\photobooth",
  # Thu muc goc noi phan mem may anh luu anh (de trong = them anh thu cong)
  [string]$CaptureDir = "",
  [string]$Password = "",
  # Tu dung server cu dang giu cong ma khong hoi
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "lib-net.ps1")

Write-Host ""
Write-Host "  Cai dat Photo Booth Studio" -ForegroundColor Cyan
Write-Host "  Thu muc ung dung: $AppDir"
Write-Host "  Thu muc du lieu:  $DataDir"
Write-Host ""

# --- Kiem tra quyen admin ---
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Host "  Can chay bang quyen Administrator." -ForegroundColor Red
  Write-Host "  Mo PowerShell bang 'Run as administrator' roi chay lai."
  exit 1
}

# --- Kiem tra Node ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "  Chua cai Node.js. Tai tai https://nodejs.org (ban 22 tro len)." -ForegroundColor Red
  exit 1
}
$ver = (node -v) -replace 'v(\d+).*', '$1'
if ([int]$ver -lt 22) {
  Write-Host "  Can Node.js 22 tro len (dang co $(node -v))." -ForegroundColor Red
  exit 1
}
Write-Host "  [ok] Node.js $(node -v)"

# --- Kiem tra da build chua ---
if (-not (Test-Path (Join-Path $AppDir "dist\index.html"))) {
  Write-Host "  Chua build giao dien. Chay 'npm install' va 'npm run build' truoc." -ForegroundColor Red
  exit 1
}
Write-Host "  [ok] Da co ban build"

# --- Kiem tra cong co bi chiem khong ---
# Nhieu may da co Apache/XAMPP/IIS chiem san cong 8080.
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($busy) {
  $ownerPid = $busy[0].OwningProcess
  $owner = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
  $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$ownerPid" -ErrorAction SilentlyContinue).CommandLine

  # Truong hop hay gap nhat: chinh server photobooth dang chay tu lan truoc.
  # Dung han no roi cai tiep, thay vi bat nguoi dung tu mo di tim.
  if ($cmdLine -and $cmdLine -match 'server[\\/]index\.ts') {
    Write-Host "  Cong $Port dang bi chinh server photobooth giu (PID $ownerPid)." -ForegroundColor Yellow
    $answer = if ($Force) { 'c' } else { Read-Host "  Dung server cu de cai lai? (c/k)" }
    if ($answer -match '^[cCyY]') {
      Stop-Process -Id $ownerPid -Force
      Start-Sleep -Seconds 2
      Write-Host "  [ok] Da dung server cu"
    } else {
      Write-Host "  Da huy. Dung server cu roi chay lai script." -ForegroundColor Red
      exit 1
    }
  } else {
    # Chuong trinh khac (Apache/XAMPP/IIS...) -> goi y cong khac cong dang dung
    $suggest = if ($Port -eq 8090) { 8091 } else { 8090 }
    Write-Host "  Cong $Port dang bi chiem boi '$($owner.ProcessName)' (PID $ownerPid)." -ForegroundColor Red
    Write-Host "  Chon cong khac, vi du:"
    Write-Host "    powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 -Port $suggest"
    Write-Host "  Hoac tat chuong trinh dang dung cong $Port roi chay lai."
    exit 1
  }
}
Write-Host "  [ok] Cong $Port dang trong"

# --- Mat khau nhan vien ---
if ([string]::IsNullOrWhiteSpace($Password)) {
  $secure = Read-Host "  Dat mat khau cho nhan vien" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
if ([string]::IsNullOrWhiteSpace($Password)) {
  Write-Host "  Mat khau khong duoc de trong." -ForegroundColor Red
  exit 1
}

# --- Thu muc du lieu ---
if (-not (Test-Path $DataDir)) {
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
}
Write-Host "  [ok] Thu muc du lieu san sang"

# --- Firewall: ca Private va Public ---
#
# Mo ca hai chu khong chi Private: Windows rat hay xep WiFi quan vao loai
# Public (mac dinh khi noi mang moi, hoac khi bam "No" o cau hoi "Allow your
# PC to be discoverable"). Khi do rule chi-Private khong ap dung, server chay
# hoan hao ma dien thoai khach bi firewall chan sach - khong co dau hieu gi
# de doan ra. Day van la mang LAN sau router, khong mo ra internet.
$ruleName = "Photo Booth Studio"
try { Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction Stop } catch {}
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -LocalPort $Port -Protocol TCP -Action Allow -Profile Private, Public | Out-Null
Write-Host "  [ok] Mo firewall cong $Port (mang Private va Public)"

# --- Dia chi LAN ---
#
# Dung Get-LanAdapter (loc card ao cua WSL / Docker / VirtualBox / VPN, va
# doi hoi card phai co default gateway) chu khong lay card IPv4 dau tien:
# chon nham card ao thi ma QR tro vao dia chi dien thoai khach khong bao gio
# toi duoc, ma trang quan ly tren may chu van mo binh thuong.
$adapter = Get-LanAdapter
$ip = Get-LanIp
if (-not $ip) {
  Write-Host "  [!] Khong tim duoc card mang dang dung. Noi WiFi hoac cam day mang." -ForegroundColor Red
  exit 1
}
$ipInfo = @($adapter.IPv4Address | Where-Object { $_.IPAddress -eq $ip })[0]
$isDhcp = $ipInfo.PrefixOrigin -ne 'Manual'
Write-Host "  [ok] Dia chi LAN: $ip ($($adapter.InterfaceAlias))"

# --- File cau hinh ---
# Dau dong '"@' PHAI o cot 0, khong duoc thut le.
#
# PHOTOBOOTH_HOST la dia chi duoc IN VAO MA QR. Ghim thang vao day thay vi
# de server tu doan card mang luc chay - xem ly do o phan tim dia chi tren.
$envFile = Join-Path $AppDir ".env.local"
$envText = @"
PHOTOBOOTH_DATA=$DataDir
PHOTOBOOTH_PASSWORD=$Password
PHOTOBOOTH_PORT=$Port
PHOTOBOOTH_CAPTURE=$CaptureDir
PHOTOBOOTH_HOST=${ip}:${Port}
"@
# Ghi UTF-8 KHONG BOM. Set-Content -Encoding utf8 tren PowerShell 5.1 luon
# them BOM, lam hong khoa dau tien khi server doc file.
[System.IO.File]::WriteAllText($envFile, $envText, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "  [ok] Ghi cau hinh vao .env.local"

# --- File khoi dong ---
# Dung here-string single-quote de PowerShell khong dien giai '@echo off',
# roi thay cac placeholder sau.
$startCmd = Join-Path $AppDir "start-server.cmd"
$cmdText = @'
@echo off
cd /d "__APPDIR__"
set PHOTOBOOTH_DATA=__DATADIR__
set PHOTOBOOTH_PASSWORD=__PASSWORD__
set PHOTOBOOTH_PORT=__PORT__
set PHOTOBOOTH_CAPTURE=__CAPTURE__
node --experimental-strip-types --disable-warning=ExperimentalWarning server\index.ts
'@
$cmdText = $cmdText.Replace('__APPDIR__', $AppDir)
$cmdText = $cmdText.Replace('__DATADIR__', $DataDir)
$cmdText = $cmdText.Replace('__PASSWORD__', $Password)
$cmdText = $cmdText.Replace('__PORT__', "$Port")
$cmdText = $cmdText.Replace('__CAPTURE__', $CaptureDir)
Set-Content -Path $startCmd -Value $cmdText -Encoding ascii
Write-Host "  [ok] Tao start-server.cmd"

# --- Tu chay khi khoi dong may ---
$taskName = "PhotoBoothStudio"
try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop } catch {}

$action = New-ScheduledTaskAction -Execute $startCmd
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -User "SYSTEM" | Out-Null
Write-Host "  [ok] Server se tu chay khi khoi dong may"

Write-Host ""
Write-Host "  Cai dat xong!" -ForegroundColor Green
Write-Host ""
Write-Host "  Nhan vien:  http://${ip}:${Port}/staff"
Write-Host "  Phong 1:    http://${ip}:${Port}/room?p=1"
Write-Host "  Phong 2:    http://${ip}:${Port}/room?p=2"
Write-Host "  Phong 3:    http://${ip}:${Port}/room?p=3"
Write-Host ""
Write-Host "  Viec con lai:" -ForegroundColor Yellow
if ($isDhcp) {
  Write-Host "   1. DAT IP TINH cho may nay - QUAN TRONG NHAT" -ForegroundColor Red
  Write-Host "      May dang lay IP tu DHCP ($ip), router co the doi bat cu luc nao."
  Write-Host "      Khi IP doi, TAT CA ma QR da phat cho khach se hong."
  Write-Host "      Cach nhanh nhat: chay scripts\dat-ip-tinh.ps1 - no doc lai"
  Write-Host "      dung bo so may dang chay tot roi ghim y nguyen, va tu tra"
  Write-Host "      lai DHCP neu mat mang. Khong phai dien so nao."
} else {
  Write-Host "   1. IP da co dinh ($ip) - tot"
}
Write-Host "   2. Tat che do ngu: Settings > Power > Screen and sleep > Never"
Write-Host "   3. BAT SAO LUU thu muc $DataDir sang o ngoai."
Write-Host "      O cung hong la mat het anh, khong co ban sao nao khac."
Write-Host "   4. Tren moi PC phong, tao shortcut Chrome:"
Write-Host "      chrome.exe --kiosk --incognito --disable-extensions ^"
Write-Host "        http://${ip}:${Port}/room?p=1"
Write-Host "      (--incognito de moi luot khach bat dau sach, khong dinh cache;"
Write-Host "       cung tranh loi Chrome tu ep HTTPS lam trang khong load duoc)"
Write-Host ""
Write-Host "  Khoi dong ngay: chay $startCmd"
Write-Host ""
