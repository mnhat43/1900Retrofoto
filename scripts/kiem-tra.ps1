# KIEM-TRA - tu chan doan he thong, viet cho nhan vien khong biet may tinh.
#
# Muc tieu: sau khi chay file nay, nhan vien biet CHINH XAC phai lam gi tiep,
# khong phai doc log hay doan.
#
# Chi dung ASCII (khong dau) - console Windows khong hien duoc chu co dau.

param([string]$AppDir)

. (Join-Path $PSScriptRoot 'lib-net.ps1')

# Goi dong san thi .env.local nam canh script; chay tu kho ma nguon thi no
# nam o thu muc cha (script o trong scripts\).
if (-not $AppDir) { $AppDir = Resolve-AppDir $PSScriptRoot }

$results = New-Object System.Collections.ArrayList
$todo = New-Object System.Collections.ArrayList

function Add-Check([string]$state, [string]$text, [string]$fix = '') {
  [void]$results.Add([pscustomobject]@{ State = $state; Text = $text })
  # Bo trung: nhieu loi khac nhau cung duoc chua bang mot viec (chay lai
  # CAI-DAT.bat). Liet ke 4 lan cung mot dong thi nhan vien tuong phai lam
  # 4 viec khac nhau, va se khong biet minh da lam den dau.
  if ($fix -and $state -ne 'OK' -and -not $todo.Contains($fix)) {
    [void]$todo.Add($fix)
  }
}

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host "    1900 RETROFOTO - KIEM TRA HE THONG" -ForegroundColor Cyan
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Dang kiem tra, cho khoang 15 giay..." -ForegroundColor Gray
Write-Host ""

# ---------------------------------------------------------------------------
# 1. Cau hinh
# ---------------------------------------------------------------------------
$envPath = Join-Path $AppDir '.env.local'
$conf = Read-EnvLocal $envPath
$port = Get-ServerPort $AppDir

if (-not (Test-Path $envPath)) {
  Add-Check 'LOI' "Chua cau hinh (khong thay file .env.local)" `
    "Chuot phai vao CAI-DAT.bat -> Run as administrator"
} else {
  Add-Check 'OK' "Da cau hinh (cong $port)"
}

# ---------------------------------------------------------------------------
# 2. Server co chay khong
# ---------------------------------------------------------------------------
$health = $null
for ($i = 1; $i -le 3; $i++) {
  $health = Test-ServerHealth $port 5
  if ($health) { break }
  if ($i -lt 3) { Start-Sleep -Seconds 3 }
}

if ($health) {
  $up = [TimeSpan]::FromSeconds($health.uptimeSeconds)
  # Kem so phien ban: cau hoi dau tien khi ho tro tu xa luon la "may dang
  # chay ban nao", va nhan vien chi can doc lai dong nay thay vi di tim.
  $v = if ($health.version) { " - ban v$($health.version)" } else { "" }
  Add-Check 'OK' ("Server dang chay (da chay {0} gio {1} phut){2}" -f [int]$up.TotalHours, $up.Minutes, $v)
} else {
  $procs = @(Get-ServerProcess $AppDir)
  if ($procs.Count -gt 0) {
    Add-Check 'LOI' "Server dang TREO (con tien trinh nhung khong tra loi)" `
      "Nhap dup loi tat KHOI-DONG-LAI ngoai man hinh"
  } else {
    Add-Check 'LOI' "Server KHONG chay" "Nhap dup loi tat KHOI-DONG-LAI ngoai man hinh"
  }
}

# ---------------------------------------------------------------------------
# 3. Dia chi mang - nguyen nhan so 1 lam ma QR cua khach chet
# ---------------------------------------------------------------------------
$ipNow = Get-LanIp
$adapter = Get-LanAdapter

if (-not $ipNow) {
  Add-Check 'LOI' "May KHONG noi mang" `
    "Kiem tra WiFi hoac day mang. Chua co mang thi khach khong quet QR duoc."
} else {
  Add-Check 'OK' "Dia chi may trong mang: $ipNow"

  # PHOTOBOOTH_HOST la dia chi duoc IN VAO MA QR. Lech voi IP thuc te la
  # truong hop nguy hiem nhat: server chay tot, trang quan ly mo duoc, ma
  # dien thoai khach khong vao duoc - khong ai doan ra vi sao.
  $hostConf = $conf['PHOTOBOOTH_HOST']
  if ($hostConf) {
    $ipConf = ($hostConf -split ':')[0]
    if ($ipConf -eq $ipNow) {
      Add-Check 'OK' "Ma QR dang tro dung dia chi may ($hostConf)"
    } else {
      Add-Check 'LOI' "MA QR TRO SAI DIA CHI: QR ghi $ipConf nhung may dang la $ipNow" `
        "Nhap dup loi tat SUA-IP ngoai man hinh - no tu sua lai het, mat 10 giay"
    }
  } else {
    Add-Check 'CANH BAO' "Chua ghim dia chi cho ma QR" `
      "Nhap dup loi tat SUA-IP ngoai man hinh de ghim dia chi hien tai"
  }

  # IP tinh hay IP thue tam
  if ($adapter) {
    $origin = @($adapter.IPv4Address | Where-Object { $_.IPAddress -eq $ipNow })[0]
    if ($origin -and $origin.PrefixOrigin -eq 'Manual') {
      Add-Check 'OK' "Dia chi da ghim co dinh (IP tinh)"
    } else {
      Add-Check 'CANH BAO' "Dia chi dang la IP THUE TAM - mat dien co the doi so" `
        "Nhap dup loi tat DAT-IP-TINH ngoai man hinh (tu dong, khong phai go gi)"
    }
  }
}

# ---------------------------------------------------------------------------
# 4. Firewall - server chay tot ma dien thoai van khong vao duoc
# ---------------------------------------------------------------------------
try {
  $rule = Get-NetFirewallRule -DisplayName '1900 Retrofoto' -ErrorAction Stop
  $prof = ($rule.Profile -join ',')

  # Cong trong rule co khop cong server dang chay khong.
  #
  # Huong dan co bao nhan vien mo .env.local bang Notepad de xem mat khau -
  # neu ai do sua luon ca PHOTOBOOTH_PORT o day ma khong chay lai CAI-DAT.bat
  # thi rule firewall se giu cong cu. Server chay tot, trang quan ly mo duoc,
  # ma dien thoai khach bi chan - dung kieu loi im lang can phat hien.
  $rulePorts = @()
  try {
    $rulePorts = @($rule | Get-NetFirewallPortFilter -ErrorAction Stop |
      ForEach-Object { $_.LocalPort })
  } catch { }
  if ($rulePorts.Count -gt 0 -and $rulePorts -notcontains [string]$port) {
    Add-Check 'LOI' "Firewall mo cong $($rulePorts -join ',') nhung server chay o cong $port" `
      "Chuot phai CAI-DAT.bat -> Run as administrator"
  }
  $cat = $null
  if ($adapter) {
    $cat = (Get-NetConnectionProfile -ErrorAction SilentlyContinue |
      Where-Object { $_.InterfaceAlias -eq $adapter.InterfaceAlias }).NetworkCategory
  }

  if ($prof -match 'Any' -or ($prof -match 'Private' -and $prof -match 'Public')) {
    Add-Check 'OK' "Firewall da mo cho ca mang Private va Public"
  } elseif ($cat -and $prof -notmatch [string]$cat) {
    Add-Check 'LOI' "Firewall mo cho mang '$prof' nhung WiFi quan dang la '$cat'" `
      "Chuot phai CAI-DAT.bat -> Run as administrator (chi can bam Cai dat lai)"
  } else {
    Add-Check 'CANH BAO' "Firewall chi mo cho mang: $prof"
  }
} catch {
  Add-Check 'LOI' "Firewall CHUA mo cho phan mem - dien thoai khach se khong vao duoc" `
    "Chuot phai CAI-DAT.bat -> Run as administrator"
}

# ---------------------------------------------------------------------------
# 5. Tu chay khi bat may
# ---------------------------------------------------------------------------
cmd.exe /c "schtasks /Query /TN $(Get-TaskName) >nul 2>&1"
if ($LASTEXITCODE -eq 0) {
  Add-Check 'OK' "Da dang ky tu chay khi bat may"
} else {
  Add-Check 'LOI' "CHUA dang ky tu chay - mat dien bat lai se khong co server" `
    "Chuot phai CAI-DAT.bat -> Run as administrator"
}

cmd.exe /c "schtasks /Query /TN $(Get-WatchTaskName) >nul 2>&1"
if ($LASTEXITCODE -eq 0) {
  Add-Check 'OK' "Da dang ky theo doi tu dong (tu cuu khi server treo)"
} else {
  Add-Check 'CANH BAO' "Chua co theo doi tu dong" `
    "Chuot phai CAI-DAT.bat -> Run as administrator"
}

# ---------------------------------------------------------------------------
# 6. Che do ngu
# ---------------------------------------------------------------------------
# GUID STANDBYIDLE. Chuoi trong ket qua powercfg bi dich theo ngon ngu
# Windows, nen doc khong ra thi coi nhu KHONG XAC DINH thay vi bao dong sai.
try {
  $pcLines = powercfg /query SCHEME_CURRENT SUB_SLEEP 29f6c1db-86da-48c5-9fdb-f2b67b1f44da 2>$null
  $pc = $pcLines -join [Environment]::NewLine
  $m = [regex]::Match($pc, '(?im)^\s*Current AC Power Setting Index:\s*0x([0-9a-f]+)')
  if ($m.Success) {
    if ([Convert]::ToInt32($m.Groups[1].Value, 16) -eq 0) {
      Add-Check 'OK' "Da tat che do ngu"
    } else {
      Add-Check 'LOI' "May VAN TU NGU - luc ngu khach khong quet QR duoc" `
        "Chuot phai CAI-DAT.bat -> Run as administrator"
    }
  }
} catch { }

# ---------------------------------------------------------------------------
# 7. O dia
# ---------------------------------------------------------------------------
if ($health -and $health.disk) {
  $freeGb = [math]::Round($health.disk.freeBytes / 1GB, 1)
  if ($health.disk.level -eq 'ok') {
    Add-Check 'OK' "O dia con $freeGb GB trong"
  } elseif ($health.disk.level -eq 'warn') {
    Add-Check 'CANH BAO' "O dia chi con $freeGb GB" `
      "Mo trang quan ly -> tab 'O dia' -> bam don anh cu"
  } else {
    Add-Check 'LOI' "O DIA GAN HET: con $freeGb GB - anh khach sap khong luu duoc" `
      "Mo trang quan ly -> tab 'O dia' -> bam don anh cu NGAY"
  }
}

# ---------------------------------------------------------------------------
# In ket qua
# ---------------------------------------------------------------------------
Write-Host "  KET QUA" -ForegroundColor White
Write-Host "  -----------------------------------------------"
foreach ($r in $results) {
  if ($r.State -eq 'OK') { $color = 'Green' }
  elseif ($r.State -eq 'CANH BAO') { $color = 'Yellow' }
  else { $color = 'Red' }
  Write-Host ("  [{0,-8}] {1}" -f $r.State, $r.Text) -ForegroundColor $color
}
Write-Host ""

if ($todo.Count -eq 0) {
  Write-Host "  TAT CA BINH THUONG. Khong can lam gi." -ForegroundColor Green
  Write-Host ""
  if ($health) {
    Write-Host "  Dia chi dung cho nhan vien va phong chup:" -ForegroundColor Gray
    Write-Host "    Trang quan ly:  http://$($health.host)/staff"
    foreach ($r in $health.rooms) {
      Write-Host "    Phong $r`:        http://$($health.host)/room?p=$r"
    }
  }
} else {
  Write-Host "  VIEC CAN LAM (lam theo thu tu tu tren xuong):" -ForegroundColor Yellow
  Write-Host "  -----------------------------------------------"
  $i = 1
  foreach ($t in $todo) {
    Write-Host "  $i. $t" -ForegroundColor White
    $i++
  }
  Write-Host ""
  Write-Host "  Lam xong thi chay lai KIEM-TRA.bat de kiem tra lan nua." -ForegroundColor Gray
}

# May dong loi cuoi trong log - chi hien khi co van de, tranh gay nhieu
if ($todo.Count -gt 0 -and $conf['PHOTOBOOTH_DATA']) {
  $srvLog = Join-Path $conf['PHOTOBOOTH_DATA'] 'logs\server.log'
  if (Test-Path $srvLog) {
    Write-Host ""
    Write-Host "  May dong cuoi trong log (dua cho ky thuat neu can):" -ForegroundColor Gray
    Get-Content $srvLog -Tail 5 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
  }
}

Write-Host ""
Write-Host "  Nhan Enter de dong cua so nay." -ForegroundColor Gray
[void](Read-Host)
