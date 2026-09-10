# KHOI-DONG-LAI - bat lai server, dung khi trang khong len.
#
# Viet cho nhan vien: nhap dup, doc mot dong ket qua, xong. Khong can mo Task
# Manager, khong can biet cua so den la gi.
#
# Chi dung ASCII (khong dau) - console Windows khong hien duoc chu co dau.

param([string]$AppDir)

. (Join-Path $PSScriptRoot 'lib-net.ps1')

# Goi dong san thi .env.local nam canh script; chay tu kho ma nguon thi no
# nam o thu muc cha (script o trong scripts\).
if (-not $AppDir) { $AppDir = Resolve-AppDir $PSScriptRoot }

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host "    1900 RETROFOTO - KHOI DONG LAI" -ForegroundColor Cyan
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host ""

$port = Get-ServerPort $AppDir

Write-Host "  Dang dung server cu..." -ForegroundColor Gray
$stopped = Stop-ServerProcess $AppDir
if ($stopped -gt 0) {
  Write-Host "  [ok] Da dung $stopped tien trinh" -ForegroundColor Green
} else {
  Write-Host "  [ok] Khong co gi dang chay" -ForegroundColor Green
}

Start-Sleep -Seconds 2

Write-Host "  Dang bat lai..." -ForegroundColor Gray
$how = Start-Server $AppDir
if ($how -eq 'none') {
  Write-Host ""
  Write-Host "  KHONG BAT DUOC: khong tim thay file chay." -ForegroundColor Red
  Write-Host "  Chuot phai vao CAI-DAT.bat -> Run as administrator." -ForegroundColor White
  Write-Host ""
  Write-Host "  Nhan Enter de dong." -ForegroundColor Gray
  [void](Read-Host)
  exit 1
}

# Doi server san sang. Lan chay dau sau khi cai dat phai nap database va
# dung 6 khung anh mau nen cham hon binh thuong -> cho toi 40 giay.
Write-Host "  Dang cho server san sang (toi 40 giay)..." -ForegroundColor Gray
$health = $null
for ($i = 1; $i -le 20; $i++) {
  Start-Sleep -Seconds 2
  $health = Test-ServerHealth $port 3
  if ($health) { break }
}

Write-Host ""
if ($health) {
  Write-Host "  XONG. Server dang chay." -ForegroundColor Green
  Write-Host ""
  Write-Host "  Mo lai trang tren may nay va tren cac may trong phong chup:" -ForegroundColor White
  Write-Host "    Trang quan ly:  http://$($health.host)/staff"
  foreach ($r in $health.rooms) {
    Write-Host "    Phong $r`:        http://$($health.host)/room?p=$r"
  }
  Write-Host ""
  Write-Host "  Neu trang van trang, nhan Ctrl + Shift + R trong trinh duyet." -ForegroundColor Gray
} else {
  Write-Host "  SERVER VAN CHUA CHAY DUOC." -ForegroundColor Red
  Write-Host ""
  Write-Host "  Nhap dup KIEM-TRA.bat - no se chi ro dang vuong o dau." -ForegroundColor White
}

Write-Host ""
Write-Host "  Nhan Enter de dong cua so nay." -ForegroundColor Gray
[void](Read-Host)
