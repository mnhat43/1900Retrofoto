# Theo doi server va cuu khi no "treo".
#
# Tac vu 1900Retrofoto-TheoDoi chay file nay 5 phut mot lan (quyen SYSTEM).
#
# VI SAO CAN, khi da co tac vu tu bat lai:
#   Tac vu chinh chi cuu duoc truong hop tien trinh CHET. Con truong hop
#   tien trinh CON SONG ma khong tra loi nua (treo, deadlock, o dia bi rut)
#   thi Windows van thay tac vu "dang chay" va khong lam gi ca - quan dung
#   ca ngay ma man hinh Task Scheduler bao moi thu binh thuong.
#
# Phan cong ro rang de khong bao gio hai ben danh nhau:
#   - File nay CHI GIET tien trinh treo (va bat lai neu chua co gi chay).
#   - Tac vu chinh CHI BAT server.

param([string]$AppDir)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib-net.ps1')

# Goi dong san thi .env.local nam canh script; chay tu kho ma nguon thi no
# nam o thu muc cha (script o trong scripts\).
if (-not $AppDir) { $AppDir = Resolve-AppDir $PSScriptRoot }

$logDir = Join-Path $AppDir 'logs'
$log = Join-Path $logDir 'theo-doi.log'

function Write-Log([string]$msg) {
  try {
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    # Cat file khi qua to, giu lai mot ban .old
    if ((Test-Path $log) -and (Get-Item $log).Length -gt 1MB) {
      Move-Item $log "$log.old" -Force
    }
    Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg) -Encoding utf8
  } catch { }
}

# Boc ca than trong try/catch: neu file nay tu chet ma khong de lai dau vet
# thi ta mat luon co che cuu, MA VAN TUONG la con - dung kieu that bai am
# tham ma ca thiet ke nay dung de chong lai.
try {

$port = Get-ServerPort $AppDir

# --- 1. Goi thu 3 lan ---
#
# Mot lan khong du: luc server dang khoi dong hoac dang ghep anh cho khach
# thi mot request le co the timeout ma server hoan toan binh thuong. Giet
# server dung luc no dang lam viec la lam hong ca phien cua khach.
$alive = $false
for ($i = 1; $i -le 3; $i++) {
  if (Test-ServerHealth $port 5) { $alive = $true; break }
  if ($i -lt 3) { Start-Sleep -Seconds 5 }
}

if ($alive) { exit 0 }

# --- 2. Khong tra loi. Xem tien trinh con khong ---
$procs = @(Get-ServerProcess $AppDir)

if ($procs.Count -eq 0) {
  Write-Log "Server khong chay. Dang bat lai."
  $how = Start-Server $AppDir
  Write-Log "Da bat lai bang: $how"
  exit 0
}

# --- 3. Con song ma khong tra loi ---
#
# Chi giet neu tien trinh da chay hon 2 phut. Duoi 2 phut thi rat co the no
# dang khoi dong (nap database, doc thu muc khung anh) - giet luc do se thanh
# vong lap giet-bat-giet vo tan.
$oldest = ($procs | Sort-Object CreationDate | Select-Object -First 1)
$age = (Get-Date) - $oldest.CreationDate

if ($age.TotalSeconds -lt 120) {
  Write-Log ("Server chua tra loi nhung moi chay {0:N0} giay - de yen, cho them." -f $age.TotalSeconds)
  exit 0
}

Write-Log ("Server TREO ({0:N0} phut khong tra loi). Dang giet va bat lai." -f $age.TotalMinutes)
$killed = Stop-ServerProcess $AppDir
Write-Log "Da dung $killed tien trinh."
Start-Sleep -Seconds 2
$how = Start-Server $AppDir
Write-Log "Da bat lai bang: $how"

}
catch {
  Write-Log "LOI trong chinh file theo-doi.ps1: $($_.Exception.Message)"
  exit 1
}
