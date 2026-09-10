# Ham dung chung cho cac script cai dat / sua chua.
#
# Dot-source tu script khac:   . "$PSScriptRoot\lib-net.ps1"
#
# LUU Y: toan bo file nay chi dung ASCII (khong dau). Console Windows chay
# codepage 437/1258 nen chu co dau se ra ky tu rac, nhan vien khong doc duoc.

# ---------------------------------------------------------------------------
# Tim card mang THAT cua quan
# ---------------------------------------------------------------------------

# Card ao cua WSL / VirtualBox / VPN. Neu chon nham card nay thi ma QR se tro
# vao dia chi ma dien thoai khach khong bao gio toi duoc, trong khi trang quan
# ly tren may chu van mo binh thuong -> khong ai phat hien ra.
$script:VirtualNic =
  'vEthernet|WSL|Loopback|VirtualBox|VMware|Hyper-V|Tailscale|ZeroTier|TAP-|Bluetooth|Npcap'

<#
  Card mang thuc su dang dung.

  Dieu kien quan trong nhat la CO DEFAULT GATEWAY: card ao cua WSL va
  VirtualBox host-only khong co gateway, nen chi mot dieu kien nay da loc
  duoc gan het truong hop nham. Loc theo ten la lop bao ve thu hai.

  Sap xep theo InterfaceMetric: Windows dat so nho cho card dang thuc su
  dung de ra mang, nen card dau tien la card dung.
#>
function Get-LanAdapter {
  Get-NetIPConfiguration -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPv4DefaultGateway -and
      $_.IPv4Address -and
      $_.NetAdapter.Status -eq 'Up' -and
      $_.InterfaceAlias -notmatch $script:VirtualNic
    } |
    Sort-Object { $_.NetIPv4Interface.InterfaceMetric } |
    Select-Object -First 1
}

# Dia chi IPv4 cua may trong mang quan. Tra ve $null neu khong tim duoc.
function Get-LanIp {
  $a = Get-LanAdapter
  if (-not $a) { return $null }
  # Mot card co the co nhieu dia chi (IP tinh dat them). Lay cai dau tien
  # khong phai 169.254.x (dia chi Windows tu gan khi xin DHCP that bai).
  $ip = @($a.IPv4Address | Where-Object { $_.IPAddress -notlike '169.254.*' })[0]
  if (-not $ip) { return $null }
  return $ip.IPAddress
}

<#
  Tim thu muc chua .env.local.

  Hai kieu bo tri deu phai chay duoc:
    - Goi dong san:  script va .env.local nam cung mot thu muc
    - Kho ma nguon:  script nam trong scripts\, .env.local o thu muc goc
#>
function Resolve-AppDir([string]$ScriptDir) {
  if (Test-Path (Join-Path $ScriptDir '.env.local')) { return $ScriptDir }
  $parent = Split-Path -Parent $ScriptDir
  if ($parent -and (Test-Path (Join-Path $parent '.env.local'))) { return $parent }
  return $ScriptDir
}

# ---------------------------------------------------------------------------
# Doc / ghi .env.local
# ---------------------------------------------------------------------------

<#
  Doc .env.local thanh bang khoa-gia tri, giu nguyen thu tu dong.

  Doc roi ghi lai ca file (thay vi sua tung dong) de khong bao gio tao ra
  file co hai dong cung mot khoa - server chi lay dong dau nen truong hop do
  rat kho hieu khi di tim loi.
#>
function Read-EnvLocal([string]$Path) {
  $map = [ordered]@{}
  if (Test-Path $Path) {
    foreach ($raw in [System.IO.File]::ReadAllLines($Path)) {
      # Bo BOM neu co o dong dau
      $line = $raw.TrimStart([char]0xFEFF)
      if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
        $map[$Matches[1]] = $Matches[2]
      }
    }
  }
  return $map
}

<#
  Ghi lai .env.local.

  PHAI la UTF-8 KHONG BOM: PowerShell 5.1 mac dinh them BOM, va khi do khoa
  dau tien bien thanh "<BOM>PHOTOBOOTH_DATA" -> server bo qua ca dong.
#>
function Write-EnvLocal([string]$Path, $Map) {
  $lines = foreach ($k in $Map.Keys) { "$k=$($Map[$k])" }
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, ($lines -join "`r`n") + "`r`n", $enc)
}

function Get-ServerPort([string]$AppDir) {
  $env = Read-EnvLocal (Join-Path $AppDir '.env.local')
  if ($env['PHOTOBOOTH_PORT']) { return [int]$env['PHOTOBOOTH_PORT'] }
  return 8090
}

<#
  Thu muc man hinh GHI DUOC.

  Uu tien man hinh dung chung (C:\Users\Public\Desktop): server chay quyen
  SYSTEM va nhan vien co the dang nhap bang tai khoan khac, nen loi tat phai
  hien voi moi nguoi. Nhung thu muc do can quyen Administrator de ghi - neu
  khong ghi duoc thi lui ve man hinh cua nguoi dang dang nhap, con hon la
  khong tao duoc loi tat nao.
#>
function Get-WritableDesktop {
  foreach ($d in @(
      [Environment]::GetFolderPath('CommonDesktopDirectory'),
      [Environment]::GetFolderPath('Desktop')
    )) {
    if (-not $d -or -not (Test-Path $d)) { continue }
    $probe = Join-Path $d ('.pb-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    try {
      [System.IO.File]::WriteAllText($probe, 'x')
      Remove-Item $probe -Force -ErrorAction SilentlyContinue
      return $d
    } catch {
      continue
    }
  }
  return [Environment]::GetFolderPath('Desktop')
}

# ---------------------------------------------------------------------------
# Khoi dong / kiem tra server
# ---------------------------------------------------------------------------

$script:TaskName = '1900Retrofoto'
$script:WatchTaskName = '1900Retrofoto-TheoDoi'

function Get-TaskName { return $script:TaskName }
function Get-WatchTaskName { return $script:WatchTaskName }

<#
  Goi thu trang kiem tra suc khoe cua server.

  Dung 127.0.0.1 chu khong dung IP LAN: can biet "server co chay khong",
  khong phai "mang co thong khong". Hai chuyen do phai tach nhau ra de
  KIEM-TRA.bat chi dung duoc benh.
#>
function Test-ServerHealth([int]$Port, [int]$TimeoutSec = 5) {
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" `
      -TimeoutSec $TimeoutSec -ErrorAction Stop
    return $r
  } catch {
    return $null
  }
}

<#
  Cac tien trinh node.exe do CHINH thu muc nay chay ra.

  Hai dieu kien, ca hai deu neo vao duong dan cua ban cai nay, nen khong bao
  gio dung tay vao node.exe cua chuong trinh khac tren may:
    - Chay bang node nhung trong goi  -> ExecutablePath khop runtime\node.exe
    - Chay bang node cai san tren may -> dong lenh co chua server\index.ts
      cua dung thu muc nay (truong hop chay tu kho ma nguon)
#>
function Get-ServerProcess([string]$AppDir) {
  $exe = Join-Path $AppDir 'runtime\node.exe'
  $marker = Join-Path $AppDir 'server\index.ts'
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ExecutablePath -eq $exe -or
      ($_.CommandLine -and $_.CommandLine.Contains($marker))
    }
}

function Stop-ServerProcess([string]$AppDir) {
  $n = 0
  foreach ($p in @(Get-ServerProcess $AppDir)) {
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; $n++ } catch { }
  }
  return $n
}

# Bat server bang Task Scheduler (chay quyen SYSTEM) neu tac vu da dang ky,
# khong thi chay truc tiep file cmd.
function Start-Server([string]$AppDir) {
  cmd.exe /c "schtasks /Run /TN $script:TaskName >nul 2>&1"
  if ($LASTEXITCODE -eq 0) { return 'task' }
  $runner = Join-Path $AppDir 'Chay-server-am-tham.cmd'
  if (Test-Path $runner) {
    Start-Process -FilePath $runner -WorkingDirectory $AppDir -WindowStyle Hidden
    return 'direct'
  }
  return 'none'
}
