# GO-CAI-DAT - go bo 1900 Retrofoto khoi may nay.
#
# Dao nguoc dung nhung gi CAI-DAT.bat (setup-gui.ps1) va install-windows.ps1
# da lam: dung server, bo tac vu tu chay, dong firewall, tra lai che do ngu,
# tra lai IP dong, xoa loi tat va file cau hinh.
#
# KHONG XOA ANH KHACH. Thu muc du lieu duoc giu nguyen va chi in ra man hinh.
# Muon xoa thi chay lai voi co -XoaDuLieu, va phai go dung ten thu muc de xac
# nhan - anh khach khong co ban sao nao khac, xoa nham la mat han.
#
# THU TU QUAN TRONG: phai bo tac vu TRUOC khi giet tien trinh. Tac vu chinh
# lap lai moi 5 phut, nen neu giet truoc thi no bat server day ngay giua luc
# dang go, va nguoi go se thay "go xong ma van con chay".
#
# Chi dung ASCII (khong dau) - console Windows khong hien duoc chu co dau.

param(
  [string]$AppDir,
  # Xoa luon thu muc anh khach (se hoi lai, phai go dung ten thu muc)
  [switch]$XoaDuLieu,
  # Khong hoi gi het - dung khi goi tu trinh go cai dat cua Windows
  [switch]$Force
)

. (Join-Path $PSScriptRoot 'lib-net.ps1')

# Goi dong san thi .env.local nam canh script; chay tu kho ma nguon thi no
# nam o thu muc cha (script o trong scripts\).
if (-not $AppDir) { $AppDir = Resolve-AppDir $PSScriptRoot }

$done = New-Object System.Collections.ArrayList
$warn = New-Object System.Collections.ArrayList

function Add-Done([string]$m) { [void]$done.Add($m); Write-Host "  [ok] $m" -ForegroundColor Green }
function Add-Warn([string]$m) { [void]$warn.Add($m); Write-Host "  [!]  $m" -ForegroundColor Yellow }

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host "    1900 RETROFOTO - GO CAI DAT" -ForegroundColor Cyan
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host ""

# --- Can quyen Administrator ---
# Bo tac vu chay quyen SYSTEM, sua firewall va doi cau hinh mang deu can quyen nay.
$admin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $admin) {
  Write-Host "  CAN QUYEN ADMINISTRATOR." -ForegroundColor Red
  Write-Host ""
  Write-Host "  Chuot phai vao GO-CAI-DAT.bat -> chon 'Run as administrator'." -ForegroundColor White
  Write-Host ""
  Write-Host "  Nhan Enter de dong." -ForegroundColor Gray
  [void](Read-Host)
  exit 1
}

# --- Doc cau hinh truoc khi xoa no ---
# Can PHOTOBOOTH_DATA va PHOTOBOOTH_PORT de bao cao cho dung. Doc ngay bay gio
# vi den buoc 8 thi .env.local khong con nua.
$envPath = Join-Path $AppDir '.env.local'
$conf = Read-EnvLocal $envPath
$dataDir = $conf['PHOTOBOOTH_DATA']
$port = Get-ServerPort $AppDir

Write-Host "  Thu muc ung dung: $AppDir"
if ($dataDir) { Write-Host "  Thu muc du lieu:  $dataDir" }
Write-Host ""

if (-not $Force) {
  Write-Host "  Se go: server tu chay, tac vu theo doi, rule firewall," -ForegroundColor White
  Write-Host "  loi tat ngoai man hinh, file cau hinh." -ForegroundColor White
  Write-Host "  Tra lai: che do ngu mac dinh, dia chi IP tu dong." -ForegroundColor White
  Write-Host ""
  if ($XoaDuLieu) {
    Write-Host "  ANH KHACH SE BI XOA (co -XoaDuLieu)." -ForegroundColor Red
  } else {
    Write-Host "  Anh khach duoc GIU NGUYEN." -ForegroundColor Green
  }
  Write-Host ""
  $ans = Read-Host "  Go cai dat? (g = go, bo trong = huy)"
  if ($ans -ne 'g' -and $ans -ne 'G') {
    Write-Host "  Da huy, khong doi gi." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Nhan Enter de dong." -ForegroundColor Gray
    [void](Read-Host)
    exit 0
  }
  Write-Host ""
}

# --- 1. Bo cac tac vu tu chay ---
#
# PHAI lam truoc khi giet tien trinh (xem ghi chu dau file). /End dung lan
# chay hien tai, /Delete bo han dang ky.
#
# Ba ten: hai tac vu cua goi dong san, va PhotoBoothStudio cua ban cai bang
# install-windows.ps1 tu thoi truoc - may da tung cai duong do van con sot lai.
Write-Host "  Dang bo tac vu tu chay..." -ForegroundColor Gray
$removedTask = 0
foreach ($t in @((Get-TaskName), (Get-WatchTaskName), 'PhotoBoothStudio')) {
  cmd.exe /c "schtasks /Query /TN $t >nul 2>&1"
  if ($LASTEXITCODE -ne 0) { continue }
  cmd.exe /c "schtasks /End /TN $t >nul 2>&1"
  cmd.exe /c "schtasks /Delete /TN $t /F >nul 2>&1"
  if ($LASTEXITCODE -eq 0) { $removedTask++ } else { Add-Warn "Khong bo duoc tac vu $t" }
}
if ($removedTask -gt 0) {
  Add-Done "Da bo $removedTask tac vu tu chay"
} else {
  Add-Done "Khong co tac vu nao dang dang ky"
}

# --- 2. Dung server ---
#
# Stop-ServerProcess chi giet node.exe do CHINH thu muc nay chay ra (neo theo
# runtime\node.exe hoac server\index.ts cua dung duong dan), nen khong dung
# tay vao Node cua chuong trinh khac tren may.
Write-Host "  Dang dung server..." -ForegroundColor Gray
$stopped = Stop-ServerProcess $AppDir
if ($stopped -gt 0) {
  Start-Sleep -Seconds 2
  Add-Done "Da dung $stopped tien trinh server"
} else {
  Add-Done "Server khong chay"
}

# Con ai giu cong khong? Neu con thi bao ro, dung de nguoi go tuong da sach.
$busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($busy) {
  $owner = Get-Process -Id $busy[0].OwningProcess -ErrorAction SilentlyContinue
  Add-Warn "Cong $port van bi '$($owner.ProcessName)' (PID $($busy[0].OwningProcess)) giu - khong phai server nay."
}

# --- 3. Dong firewall ---
# Hai ten: goi dong san dung '1900 Retrofoto', install-windows.ps1 dung
# 'Photo Booth Studio'.
Write-Host "  Dang dong firewall..." -ForegroundColor Gray
$removedRule = 0
foreach ($r in @('1900 Retrofoto', 'Photo Booth Studio')) {
  if (Get-NetFirewallRule -DisplayName $r -ErrorAction SilentlyContinue) {
    try { Remove-NetFirewallRule -DisplayName $r -ErrorAction Stop; $removedRule++ }
    catch { Add-Warn "Khong xoa duoc rule firewall '$r'" }
  }
}
if ($removedRule -gt 0) {
  Add-Done "Da xoa $removedRule rule firewall"
} else {
  Add-Done "Khong co rule firewall nao"
}

# --- 4. Bo ngoai le Windows Defender ---
# Khong bat buoc thanh cong: may co the khong dung Defender, hoac dung phan
# mem diet virus khac.
Write-Host "  Dang bo ngoai le Windows Defender..." -ForegroundColor Gray
$removedExc = 0
foreach ($p in @($AppDir, $dataDir)) {
  if (-not $p) { continue }
  try { Remove-MpPreference -ExclusionPath $p -ErrorAction Stop; $removedExc++ } catch { }
}
if ($removedExc -gt 0) {
  Add-Done "Da bo $removedExc ngoai le Defender"
} else {
  Add-Done "Khong co ngoai le Defender nao de bo"
}

# --- 5. Tra lai che do ngu mac dinh ---
#
# setup-gui.ps1 dat tat ca thanh 0 (khong bao gio ngu) va bat "dong nap khong
# lam gi". Tra ve bo so mac dinh cua Windows: ngu sau 30 phut khi cam dien,
# 15 phut khi chay pin, dong nap thi ngu (1 = Sleep).
Write-Host "  Dang tra lai che do ngu mac dinh..." -ForegroundColor Gray
try {
  powercfg /change standby-timeout-ac 30 | Out-Null
  powercfg /change hibernate-timeout-ac 180 | Out-Null
  powercfg /change disk-timeout-ac 20 | Out-Null
  powercfg /change monitor-timeout-ac 10 | Out-Null

  powercfg /change standby-timeout-dc 15 | Out-Null
  powercfg /change hibernate-timeout-dc 180 | Out-Null
  powercfg /change disk-timeout-dc 10 | Out-Null
  powercfg /change monitor-timeout-dc 5 | Out-Null

  #   4f971e89-... = nhom "Power buttons and lid"
  #   5ca83367-... = "Lid close action",  1 = Sleep
  foreach ($mode in @('setacvalueindex', 'setdcvalueindex')) {
    powercfg /$mode SCHEME_CURRENT `
      4f971e89-eebd-4455-a8de-9e59040e7347 `
      5ca83367-6e45-459f-a27b-476b1d01c936 1 | Out-Null
  }
  powercfg /setactive SCHEME_CURRENT | Out-Null
  Add-Done "Da tra lai che do ngu mac dinh"
} catch {
  Add-Warn "Khong tra lai duoc che do ngu. Vao Settings > Power de dat lai neu can."
}

# --- 6. Tra lai dia chi IP tu dong ---
#
# Chi dong vao khi DAT-IP-TINH da tung ghim (PrefixOrigin = Manual). May lay
# IP tu DHCP san thi khong co gi de tra.
Write-Host "  Dang kiem tra dia chi IP..." -ForegroundColor Gray
$a = Get-LanAdapter
if (-not $a) {
  Add-Warn "Khong tim duoc card mang - bo qua phan dia chi IP."
} else {
  $ipObj = @($a.IPv4Address | Where-Object { $_.IPAddress -notlike '169.254.*' })[0]
  if ($ipObj -and $ipObj.PrefixOrigin -eq 'Manual') {
    $idx = $a.InterfaceIndex
    try {
      Remove-NetIPAddress -InterfaceIndex $idx -AddressFamily IPv4 -Confirm:$false -ErrorAction SilentlyContinue
      Remove-NetRoute -InterfaceIndex $idx -DestinationPrefix '0.0.0.0/0' -Confirm:$false -ErrorAction SilentlyContinue
      Set-NetIPInterface -InterfaceIndex $idx -Dhcp Enabled -ErrorAction Stop
      Set-DnsClientServerAddress -InterfaceIndex $idx -ResetServerAddresses -ErrorAction Stop
      # Cho Windows xin lai dia chi roi kiem tra xem co that khong
      Start-Sleep -Seconds 8
      $newIp = Get-LanIp
      if ($newIp) {
        Add-Done "Da tra lai dia chi tu dong (dia chi moi: $newIp)"
      } else {
        Add-Warn "Da chuyen sang dia chi tu dong nhung chua nhan duoc IP. Khoi dong lai may, hoac cam lai day mang."
      }
    } catch {
      Add-Warn "Khong tra lai duoc dia chi tu dong: $($_.Exception.Message)"
    }
  } else {
    Add-Done "Dia chi IP dang la tu dong - khong can tra"
  }
}

# --- 7. Xoa loi tat ngoai man hinh ---
#
# Quet ca man hinh dung chung va man hinh ca nhan: luc cai, Get-WritableDesktop
# uu tien man hinh chung nhung lui ve man hinh ca nhan neu khong ghi duoc, nen
# khong doan duoc loi tat nam o dau.
Write-Host "  Dang xoa loi tat..." -ForegroundColor Gray
$shortcuts = @(
  '1900 Retrofoto.url',
  '1900 Retrofoto.lnk',
  'KIEM-TRA (chay khi co van de).lnk',
  'KHOI-DONG-LAI.lnk',
  'SUA-IP (khi doi dia chi).lnk',
  'DAT-IP-TINH (ghim dia chi).lnk',
  'CAP-NHAT (len ban moi).lnk'
)
$removedSc = 0
foreach ($d in @(
    [Environment]::GetFolderPath('CommonDesktopDirectory'),
    [Environment]::GetFolderPath('Desktop')
  )) {
  if (-not $d -or -not (Test-Path $d)) { continue }
  foreach ($s in $shortcuts) {
    $p = Join-Path $d $s
    if (Test-Path $p) {
      try { Remove-Item $p -Force -ErrorAction Stop; $removedSc++ } catch { }
    }
  }
}
if ($removedSc -gt 0) {
  Add-Done "Da xoa $removedSc loi tat"
} else {
  Add-Done "Khong co loi tat nao"
}

# --- 8. Xoa file cau hinh va log ---
#
# .env.local chua MAT KHAU nhan vien nen phai xoa. start-server.cmd (do
# install-windows.ps1 tao) cung chua mat khau dang chu thuong.
#
# KHONG xoa thu muc ung dung: chay tu kho ma nguon thi day la ma nguon cua
# nguoi dung, con goi dong san thi trinh go cai dat cua Windows lo phan do.
Write-Host "  Dang xoa file cau hinh..." -ForegroundColor Gray
$removedFile = 0
foreach ($f in @($envPath, (Join-Path $AppDir 'start-server.cmd'))) {
  if (Test-Path $f) {
    try { Remove-Item $f -Force -ErrorAction Stop; $removedFile++ } catch { Add-Warn "Khong xoa duoc $f" }
  }
}
$logDir = Join-Path $AppDir 'logs'
if (Test-Path $logDir) {
  try { Remove-Item $logDir -Recurse -Force -ErrorAction Stop; $removedFile++ } catch { Add-Warn "Khong xoa duoc thu muc logs" }
}
Add-Done "Da xoa $removedFile file cau hinh / log"

# --- 9. Thu muc anh khach ---
#
# Mac dinh GIU NGUYEN. Anh khach khong co ban sao nao khac, va nguoi bam nham
# trong luc go thi khong lay lai duoc. Muon xoa phai them co -XoaDuLieu VA go
# dung ten thu muc - hai lop de khong bao gio xay ra do nham tay.
$dataKept = $false
if ($dataDir -and (Test-Path $dataDir)) {
  $size = 0
  try {
    $size = [math]::Round(
      (Get-ChildItem $dataDir -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object Length -Sum).Sum / 1MB)
  } catch { }

  if ($XoaDuLieu) {
    Write-Host ""
    Write-Host "  SAP XOA TOAN BO ANH KHACH TRONG:" -ForegroundColor Red
    Write-Host "    $dataDir  ($size MB)" -ForegroundColor Red
    Write-Host "  Khong lay lai duoc." -ForegroundColor Red
    Write-Host ""
    $leaf = Split-Path -Leaf $dataDir
    $typed = Read-Host "  Go dung ten thu muc ($leaf) de xac nhan"
    if ($typed -eq $leaf) {
      try {
        Remove-Item $dataDir -Recurse -Force -ErrorAction Stop
        Add-Done "Da xoa thu muc du lieu $dataDir"
      } catch {
        Add-Warn "Khong xoa duoc ${dataDir}: $($_.Exception.Message)"
        $dataKept = $true
      }
    } else {
      Add-Warn "Go khong khop - KHONG xoa. Anh khach con nguyen."
      $dataKept = $true
    }
  } else {
    $dataKept = $true
  }
}

# --- Ket qua ---
Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host "    DA GO XONG" -ForegroundColor Green
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host ""

if ($dataKept) {
  Write-Host "  ANH KHACH VAN CON O:" -ForegroundColor Yellow
  Write-Host "    $dataDir" -ForegroundColor White
  Write-Host "  Chep sang o ngoai truoc khi xoa tay, hoac chay lai lenh nay" -ForegroundColor Gray
  Write-Host "  voi -XoaDuLieu neu chac chan khong can nua." -ForegroundColor Gray
  Write-Host ""
}

if ($warn.Count -gt 0) {
  Write-Host "  Con vuong may viec:" -ForegroundColor Yellow
  foreach ($w in $warn) { Write-Host "    - $w" -ForegroundColor White }
  Write-Host ""
}

Write-Host "  Neu day la goi cai dat, vao Settings > Apps de go not" -ForegroundColor Gray
Write-Host "  '1900 Retrofoto' khoi may." -ForegroundColor Gray
Write-Host ""

if (-not $Force) {
  Write-Host "  Nhan Enter de dong cua so nay." -ForegroundColor Gray
  [void](Read-Host)
}
