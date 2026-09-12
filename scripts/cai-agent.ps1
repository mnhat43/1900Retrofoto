<#
  Dang ky agent chay ngam khi bat may, khong can de cua so den mo suot.

  Cach dung (chuot phai CAI-AGENT.bat -> Run as administrator):
    powershell -ExecutionPolicy Bypass -File scripts\cai-agent.ps1

  VI SAO KHONG DUNG SYSTEM nhu tac vu server:
  Agent doc anh qua duong dan mang (\MAY2\..., \MAY3\...). Tai khoan
  SYSTEM khong mang theo thong tin dang nhap mang cua nguoi dung, nen no
  se bao "khong tim thay thu muc" du Explorer mo binh thuong. Phai chay
  duoi chinh tai khoan dang dung may.

  Doi lai: tac vu chi chay khi tai khoan do da dang nhap Windows. May chu
  quan thuong de dang nhap san nen khong thanh van de.
#>
param(
  [switch]$Go   # go bo thay vi cai
)

$ErrorActionPreference = 'Stop'
$AppDir = Split-Path -Parent $PSScriptRoot
$TaskName = '1900Retrofoto-Agent'

function Say($m) { Write-Host "  $m" }

if ($Go) {
  try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
    Say "[ok] Da go tac vu agent"
  } catch { Say "[--] Khong co tac vu agent nao de go" }
  Get-Process node -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "$AppDir*" } |
    ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
  exit 0
}

$runner = Join-Path $AppDir 'Chay-agent-am-tham.cmd'
if (-not (Test-Path $runner)) {
  Write-Host "  [LOI] Khong thay $runner" -ForegroundColor Red
  exit 1
}

# Chay duoi tai khoan dang dang nhap, khong phai SYSTEM - xem ghi chu dau file.
$me = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited

$act = New-ScheduledTaskAction -Execute $runner -WorkingDirectory $AppDir

# Hai moc bat: luc dang nhap Windows, va lap lai moi 5 phut de bat lai neu
# agent chet giua ngay. MultipleInstances=IgnoreNew nen dang chay thi lan
# bat moi bi bo qua, khong bao gio co hai agent cung luc.
$tLogon = New-ScheduledTaskTrigger -AtLogOn -User $me
$tLoop = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 5)

# ExecutionTimeLimit=0: khong gioi han. Mac dinh Windows giet tac vu sau 3
# ngay, va do dung la kieu loi chi xuat hien sau khi giao may cho quan lau.
$set = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $act `
  -Trigger @($tLogon, $tLoop) -Settings $set -Principal $principal -Force | Out-Null
Say "[ok] Da dang ky tac vu '$TaskName' (chay duoi $me)"

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 8

# Kiem chung that: hoi server xem no da thay agent chua, thay vi chi bao
# "da dang ky" roi de nguoi dung tu phat hien la khong chay.
$envFile = Join-Path $AppDir '.env.local'
$port = 8090
if (Test-Path $envFile) {
  foreach ($line in [System.IO.File]::ReadAllLines($envFile)) {
    if ($line -match '^\s*PHOTOBOOTH_PORT\s*=\s*(\d+)') { $port = [int]$Matches[1] }
  }
}

$seen = $false
foreach ($room in 2, 3) {
  try {
    $r = Invoke-RestMethod "http://127.0.0.1:$port/api/room/session?room=$room" -TimeoutSec 5
    if ($r.agent) { $seen = $true }
  } catch { }
}

if ($seen) {
  Say "[ok] Server da thay agent - khong can mo cua so den nua"
} else {
  Say "[!!] Tac vu da dang ky nhung server CHUA thay agent."
  Say "     Thuong la do chua vao duoc thu muc anh tren may phong."
  Say "     Thu nhap dup Chay-agent.cmd de doc thong bao loi."
}
