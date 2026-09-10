# DAT-IP-TINH - ghim dia chi may chu co dinh, tu dong, khong phai go so nao.
#
# VI SAO KHONG BAT NHAN VIEN TU DIEN TRONG SETTINGS:
#   Bang 4 o trong Windows Settings rat de dien sai. Gateway thuong la ".1"
#   nhung khong phai luon luon - co router dung ".254", co mang la 10.x. Dien
#   sai gateway thi may mat mang hoan toan, va nhan vien khong biet sua.
#
#   File nay DOC LAI dung cau hinh ma may DANG chay tot (do cuc WiFi cap),
#   roi ghim y nguyen bo so do lai. Khong doan, khong go tay, nen khong sai.
#
# CO DUONG LUI: sau khi ghim, script tu thu mang. Neu mat mang thi no tra
# lai che do cu ngay lap tuc.
#
# Chi dung ASCII (khong dau) - console Windows khong hien duoc chu co dau.

param([string]$AppDir)

. (Join-Path $PSScriptRoot 'lib-net.ps1')

# Goi dong san thi .env.local nam canh script; chay tu kho ma nguon thi no
# nam o thu muc cha (script o trong scripts\).
if (-not $AppDir) { $AppDir = Resolve-AppDir $PSScriptRoot }

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host "    1900 RETROFOTO - GHIM DIA CHI CO DINH" -ForegroundColor Cyan
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host ""

# --- Can quyen Administrator ---
$admin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $admin) {
  Write-Host "  CAN QUYEN ADMINISTRATOR." -ForegroundColor Red
  Write-Host ""
  Write-Host "  Chuot phai vao DAT-IP-TINH.bat -> chon 'Run as administrator'." -ForegroundColor White
  Write-Host "  (Nhap dup binh thuong la khong du quyen doi mang.)" -ForegroundColor Gray
  Write-Host ""
  Write-Host "  Nhan Enter de dong." -ForegroundColor Gray
  [void](Read-Host)
  exit 1
}

# --- 1. Doc cau hinh dang chay ---
$a = Get-LanAdapter
if (-not $a) {
  Write-Host "  KHONG TIM DUOC CARD MANG DANG DUNG." -ForegroundColor Red
  Write-Host "  Noi WiFi hoac cam day mang xong roi chay lai." -ForegroundColor White
  Write-Host ""
  Write-Host "  Nhan Enter de dong." -ForegroundColor Gray
  [void](Read-Host)
  exit 1
}

$idx = $a.InterfaceIndex
$alias = $a.InterfaceAlias
$ipObj = @($a.IPv4Address | Where-Object { $_.IPAddress -notlike '169.254.*' })[0]
$ip = $ipObj.IPAddress
$prefix = $ipObj.PrefixLength
$gw = $a.IPv4DefaultGateway.NextHop
$dns = @($a.DNSServer | Where-Object { $_.AddressFamily -eq 2 } |
    ForEach-Object { $_.ServerAddresses } | Where-Object { $_ })

# Them DNS cua Google lam du phong. Neu DNS cua router chet thi may van
# tra duoc ten mien - khong anh huong den viec khach quet QR (dung IP)
# nhung giup phan cap nhat va kiem tra mang khong bao dong sai.
if ($dns -notcontains '8.8.8.8') { $dns += '8.8.8.8' }

Write-Host "  Cau hinh may DANG chay tot:" -ForegroundColor White
Write-Host "    Card mang: $alias"
Write-Host "    Dia chi:   $ip /$prefix"
Write-Host "    Gateway:   $gw"
Write-Host "    DNS:       $($dns -join ', ')"
Write-Host ""

if ($ipObj.PrefixOrigin -eq 'Manual') {
  Write-Host "  Dia chi nay DA duoc ghim co dinh tu truoc. Khong can lam gi." -ForegroundColor Green
  Write-Host ""
  Write-Host "  Nhan Enter de dong." -ForegroundColor Gray
  [void](Read-Host)
  exit 0
}

Write-Host "  Se ghim y nguyen bo so tren lai, de mat dien hay khoi dong lai" -ForegroundColor Gray
Write-Host "  cuc WiFi thi dia chi khong doi nua." -ForegroundColor Gray
Write-Host ""
Write-Host "  Neu ghim xong ma mat mang, script tu tra lai nhu cu." -ForegroundColor Gray
Write-Host ""
$ans = Read-Host "  Ghim dia chi $ip lai? (g = ghim, bo trong = huy)"
if ($ans -ne 'g' -and $ans -ne 'G') {
  Write-Host "  Da huy, khong doi gi." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  Nhan Enter de dong." -ForegroundColor Gray
  [void](Read-Host)
  exit 0
}

# --- 2. Ap dung ---
function Restore-Dhcp {
  Write-Host "  Dang tra lai che do cu (nhan dia chi tu dong)..." -ForegroundColor Yellow
  try { Remove-NetIPAddress -InterfaceIndex $idx -AddressFamily IPv4 -Confirm:$false -ErrorAction SilentlyContinue } catch { }
  try { Remove-NetRoute -InterfaceIndex $idx -DestinationPrefix '0.0.0.0/0' -Confirm:$false -ErrorAction SilentlyContinue } catch { }
  try { Set-NetIPInterface -InterfaceIndex $idx -Dhcp Enabled -ErrorAction Stop } catch { }
  try { Set-DnsClientServerAddress -InterfaceIndex $idx -ResetServerAddresses -ErrorAction Stop } catch { }
  # Cho Windows xin lai dia chi
  Start-Sleep -Seconds 6
}

Write-Host ""
Write-Host "  Dang ghim..." -ForegroundColor Gray
try {
  Set-NetIPInterface -InterfaceIndex $idx -Dhcp Disabled -ErrorAction Stop
  Remove-NetIPAddress -InterfaceIndex $idx -AddressFamily IPv4 -Confirm:$false -ErrorAction SilentlyContinue
  Remove-NetRoute -InterfaceIndex $idx -DestinationPrefix '0.0.0.0/0' -Confirm:$false -ErrorAction SilentlyContinue
  New-NetIPAddress -InterfaceIndex $idx -IPAddress $ip -PrefixLength $prefix `
    -DefaultGateway $gw -ErrorAction Stop | Out-Null
  Set-DnsClientServerAddress -InterfaceIndex $idx -ServerAddresses $dns -ErrorAction Stop
} catch {
  Write-Host "  Ghim that bai: $($_.Exception.Message)" -ForegroundColor Red
  Restore-Dhcp
  Write-Host "  Da tra lai nhu cu. May van dung duoc binh thuong." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  Nhan Enter de dong." -ForegroundColor Gray
  [void](Read-Host)
  exit 1
}

# --- 3. Thu mang. Khong thong thi tra lai ngay ---
#
# Thu gateway truoc (mang noi bo - cai nay moi anh huong den khach quet QR),
# roi thu ra internet. Mat internet thi canh bao chu khong tra lai, vi quan
# van ban hang duoc; mat gateway thi phai tra lai ngay.
Write-Host "  Dang thu mang..." -ForegroundColor Gray
Start-Sleep -Seconds 3

$lanOk = Test-Connection -ComputerName $gw -Count 2 -Quiet -ErrorAction SilentlyContinue
if (-not $lanOk) {
  Write-Host "  MANG NOI BO KHONG THONG sau khi ghim." -ForegroundColor Red
  Restore-Dhcp
  Write-Host "  Da tra lai nhu cu. May van dung duoc binh thuong." -ForegroundColor Yellow
  Write-Host "  Nho ky thuat dat IP tinh gium." -ForegroundColor White
  Write-Host ""
  Write-Host "  Nhan Enter de dong." -ForegroundColor Gray
  [void](Read-Host)
  exit 1
}

Write-Host "  [ok] Mang noi bo thong - khach quet QR duoc" -ForegroundColor Green

$netOk = $false
try {
  $netOk = (Resolve-DnsName -Name 'google.com' -QuickTimeout -ErrorAction Stop) -ne $null
} catch { $netOk = $false }

if ($netOk) {
  Write-Host "  [ok] Ra internet duoc" -ForegroundColor Green
} else {
  Write-Host "  [!] Khong ra internet duoc (DNS)." -ForegroundColor Yellow
  Write-Host "      Quan van ban hang binh thuong - phan nay chi can khi cap nhat." -ForegroundColor Gray
}

# --- 4. Ghim lai dia chi cho ma QR ---
$envPath = Join-Path $AppDir '.env.local'
if (Test-Path $envPath) {
  $conf = Read-EnvLocal $envPath
  $port = Get-ServerPort $AppDir
  $conf['PHOTOBOOTH_HOST'] = "$ip`:$port"
  Write-EnvLocal $envPath $conf
  Write-Host "  [ok] Da ghim dia chi $ip`:$port cho ma QR" -ForegroundColor Green
}

Write-Host ""
Write-Host "  XONG. Dia chi $ip da co dinh." -ForegroundColor Green
Write-Host ""
Write-Host "  Mot viec nen lam them (nho ky thuat hoac chu quan):" -ForegroundColor Gray
Write-Host "  Vao trang quan ly cua cuc WiFi, dat 'DHCP reservation' cho dia" -ForegroundColor Gray
Write-Host "  chi $ip. Nhu vay cuc WiFi khong bao gio cap so nay cho may khac." -ForegroundColor Gray
Write-Host ""
Write-Host "  Nhan Enter de dong cua so nay." -ForegroundColor Gray
[void](Read-Host)
