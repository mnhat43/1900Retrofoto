# SUA-IP - ghim lai dia chi may chu sau khi no bi doi.
#
# VI SAO CAN FILE NAY:
#   Ma QR dua cho khach co chua dia chi may chu. Neu dia chi doi (mat dien,
#   khoi dong lai cuc WiFi, doi router) thi server van chay tot, trang quan
#   ly van mo duoc, nhung dien thoai khach quet QR se ra trang trong - va
#   khong ai doan ra vi sao.
#
#   File nay tim dia chi moi, ghi lai vao cau hinh, tao lai loi tat va bat
#   lai server. Nhan vien chi can nhap dup, khong phai go gi.
#
# Chi dung ASCII (khong dau) - console Windows khong hien duoc chu co dau.

param([string]$AppDir)

. (Join-Path $PSScriptRoot 'lib-net.ps1')

# Goi dong san thi .env.local nam canh script; chay tu kho ma nguon thi no
# nam o thu muc cha (script o trong scripts\).
if (-not $AppDir) { $AppDir = Resolve-AppDir $PSScriptRoot }

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host "    1900 RETROFOTO - SUA DIA CHI" -ForegroundColor Cyan
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host ""

$envPath = Join-Path $AppDir '.env.local'
if (-not (Test-Path $envPath)) {
  Write-Host "  Chua cai dat. Chuot phai vao CAI-DAT.bat -> Run as administrator." -ForegroundColor Red
  Write-Host ""
  Write-Host "  Nhan Enter de dong." -ForegroundColor Gray
  [void](Read-Host)
  exit 1
}

# --- 1. Tim dia chi hien tai ---
$ip = Get-LanIp
if (-not $ip) {
  Write-Host "  KHONG TIM DUOC DIA CHI MANG." -ForegroundColor Red
  Write-Host ""
  Write-Host "  May chua noi WiFi hoac chua cam day mang." -ForegroundColor White
  Write-Host "  Noi mang xong roi chay lai file nay." -ForegroundColor White
  Write-Host ""
  Write-Host "  Nhan Enter de dong." -ForegroundColor Gray
  [void](Read-Host)
  exit 1
}

$conf = Read-EnvLocal $envPath
$port = Get-ServerPort $AppDir
$newHost = "$ip`:$port"
$oldHost = $conf['PHOTOBOOTH_HOST']

if ($oldHost -eq $newHost) {
  Write-Host "  Dia chi khong doi ($newHost). Khong can sua gi." -ForegroundColor Green
} else {
  if ($oldHost) {
    Write-Host "  Dia chi cu:  $oldHost" -ForegroundColor Yellow
  }
  Write-Host "  Dia chi moi: $newHost" -ForegroundColor Green
}
Write-Host ""

# --- 2. Ghi vao cau hinh ---
#
# PHOTOBOOTH_HOST la thu server dung de dung ma QR. Ghi thang vao day thay vi
# de server tu doan card mang: may nao co WSL / VirtualBox / VPN deu moc them
# card ao, doan sai la QR tro vao noi dien thoai khach khong toi duoc.
$conf['PHOTOBOOTH_HOST'] = $newHost
Write-EnvLocal $envPath $conf
Write-Host "  [ok] Da ghi dia chi vao cau hinh" -ForegroundColor Green

# --- 3. Tao lai loi tat tren man hinh ---
$desktop = Get-WritableDesktop

# Dung file .url (khong phai .lnk): day dung la kieu loi tat cho dia chi web,
# Windows luon mo bang trinh duyet mac dinh.
$urlFile = Join-Path $desktop '1900 Retrofoto.url'
@(
  '[InternetShortcut]',
  "URL=http://$newHost/staff"
) | Set-Content -Path $urlFile -Encoding ascii

# Loi tat kieu cu tu ban truoc - bo di cho khoi co hai cai tro hai noi
$oldLnk = Join-Path $desktop '1900 Retrofoto.lnk'
if (Test-Path $oldLnk) { Remove-Item $oldLnk -Force -ErrorAction SilentlyContinue }

Write-Host "  [ok] Da tao lai loi tat ngoai man hinh" -ForegroundColor Green

# --- 4. Ghi danh sach dia chi ra file de con tra lai ---
$addrFile = Join-Path $desktop 'DIA-CHI-1900RETROFOTO.txt'
$rooms = if ($conf['PHOTOBOOTH_ROOMS']) { $conf['PHOTOBOOTH_ROOMS'] -split ',' } else { @('1', '2', '3') }
$lines = New-Object System.Collections.ArrayList
[void]$lines.Add("DIA CHI HE THONG 1900 RETROFOTO")
[void]$lines.Add("Cap nhat luc: $(Get-Date -Format 'dd/MM/yyyy HH:mm')")
[void]$lines.Add("")
[void]$lines.Add("Trang quan ly:  http://$newHost/staff")
foreach ($r in $rooms) {
  [void]$lines.Add("Phong $($r.Trim()):        http://$newHost/room?p=$($r.Trim())")
}
[void]$lines.Add("")
[void]$lines.Add("Neu dia chi tren doi, chay lai SUA-IP.bat roi sua loi tat")
[void]$lines.Add("tren TUNG MAY TRONG PHONG CHUP cho khop.")
$lines | Set-Content -Path $addrFile -Encoding utf8
Write-Host "  [ok] Da ghi danh sach dia chi ra man hinh (DIA-CHI-1900RETROFOTO.txt)" -ForegroundColor Green

# --- 5. Bat lai server de no doc cau hinh moi ---
Write-Host ""
Write-Host "  Dang khoi dong lai server..." -ForegroundColor Gray
[void](Stop-ServerProcess $AppDir)
Start-Sleep -Seconds 2
[void](Start-Server $AppDir)

$ok = $false
for ($i = 1; $i -le 12; $i++) {
  Start-Sleep -Seconds 2
  if (Test-ServerHealth $port 3) { $ok = $true; break }
}

Write-Host ""
if ($ok) {
  Write-Host "  XONG. Server dang chay voi dia chi moi." -ForegroundColor Green
} else {
  Write-Host "  Da sua cau hinh nhung server chua tra loi." -ForegroundColor Yellow
  Write-Host "  Chay KIEM-TRA.bat de xem con vuong gi." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  DIA CHI DUNG TU GIO:" -ForegroundColor White
Write-Host "    Trang quan ly:  http://$newHost/staff"
foreach ($r in $rooms) {
  Write-Host "    Phong $($r.Trim()):        http://$newHost/room?p=$($r.Trim())"
}

if ($oldHost -and $oldHost -ne $newHost) {
  Write-Host ""
  Write-Host "  CON MOT VIEC PHAI LAM BANG TAY:" -ForegroundColor Yellow
  Write-Host "  Loi tat tren tung MAY TRONG PHONG CHUP van ghi dia chi cu." -ForegroundColor White
  Write-Host "  Ra tung phong, chuot phai vao loi tat -> Properties -> sua" -ForegroundColor White
  Write-Host "  dia chi thanh dia chi moi o tren." -ForegroundColor White
  Write-Host ""
  Write-Host "  De khoi phai lam lai lan sau: nhap dup DAT-IP-TINH.bat" -ForegroundColor Gray
  Write-Host "  de ghim dia chi co dinh cho may nay." -ForegroundColor Gray
}

Write-Host ""
Write-Host "  Nhan Enter de dong cua so nay." -ForegroundColor Gray
[void](Read-Host)
