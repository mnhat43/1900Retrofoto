# CAP-NHAT - dua ban dang chay len phien ban moi nhat.
#
# Chay duoc theo HAI kieu, script tu nhan ra dang o kieu nao:
#
#   TU DONG  - nhap dup loi tat CAP-NHAT (hoac file trong thu muc cai dat).
#              Script hoi GitHub xem ban moi nhat la gi, co ban moi thi tu
#              tai ZIP ve %TEMP%, giai nen, roi cap nhat. Nhan vien khong
#              phai mo trinh duyet, khong phai tai, khong phai giai nen.
#
#   TAY      - chay tu mot thu muc vua giai nen san. Dung khi may quan khong
#              ra duoc Internet: tai ZIP bang may khac, chep USB sang.
#
# Giu lai:  .env.local (mat khau, cong, dia chi QR), logs\
# Khong dung toi: thu muc anh va database (nam ngoai, theo PHOTOBOOTH_DATA)
#
# Chi dung ASCII (khong dau) - console Windows khong hien duoc chu co dau.

param(
  [string]$NewDir,
  [string]$OldDir,
  # Bo qua cau hoi xac nhan. Chi dung khi script tu goi lai chinh no sau khi
  # tai xong - luc do nhan vien da dong y mot lan roi.
  [switch]$Yes
)

. (Join-Path $PSScriptRoot 'lib-net.ps1')

# Goi khong kem tham so (nhap dup loi tat, hoac CAP-NHAT.bat trong thu muc vua
# giai nen) thi goi "moi" chinh la thu muc chua script nay. CAP-NHAT.bat khong
# truyen gi ca, nen thieu dong nay la $NewDir rong va moi Join-Path phia duoi
# deu nem loi ra man hinh.
if (-not $NewDir) { $NewDir = $PSScriptRoot }

$Repo = 'mnhat43/1900Retrofoto'
$AssetName = '1900Retrofoto.zip'

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

<#
  Phien ban cua mot ban cai, doc tu package.json.

  Doc tu file chu khong goi /api/health: phai biet so nay CA KHI server dang
  chet - do chinh la luc hay phai cap nhat nhat.
#>
function Get-AppVersion([string]$Dir) {
  try {
    # '-ErrorAction Stop' la bat buoc: thieu file thi Get-Content nem loi
    # KHONG ket thuc, catch khong bat duoc, va chu do van loe ra man hinh
    # trong khi ham van tra ve binh thuong.
    $raw = Get-Content (Join-Path $Dir 'package.json') -Raw -ErrorAction Stop
    $j = $raw | ConvertFrom-Json
    if ($j.version) { return [string]$j.version }
  } catch { }
  return '0.0.0'
}

# So sanh kieu 1.10.0 > 1.9.0 (so sanh chuoi se ra nguoc). Khong doc duoc
# ben nao thi coi nhu CO ban moi - tha cap nhat thua con hon ket o ban cu.
function Test-NewerVersion([string]$Latest, [string]$Current) {
  try { return ([version]$Latest) -gt ([version]$Current) } catch { return $true }
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

# Chua dang ky tac vu (cai bang tay, hoac tac vu bi xoa) -> do cac cho quen.
#
# Phai Test-Path ca thu muc TRUOC: 'Join-Path D:\... x' tren may khong co o D
# nem loi do loe ra man hinh, nhan vien tuong hong trong khi script van chay
# binh thuong.
if (-not $OldDir) {
  foreach ($guess in @('C:\1900Retrofoto', 'D:\1900Retrofoto', 'E:\1900Retrofoto')) {
    if (-not (Test-Path $guess)) { continue }
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

# ---------------------------------------------------------------------------
# 3. Chay tu CHINH ban dang cai -> che do TU DONG: tu tai ban moi ve
# ---------------------------------------------------------------------------
#
# Day la duong nhan vien di: nhap dup loi tat CAP-NHAT ngoai man hinh. Loi
# tat tro vao thu muc cai dat, nen NewDir trung OldDir - lay do lam dau hieu
# "khong co san goi moi, phai tu di lay".
#
# -ErrorAction SilentlyContinue chu khong de Resolve-Path nem loi: duong dan
# khong phan giai duoc thi cau lenh nay hong, dieu kien thanh sai, va script
# lang le roi xuong che do TAY voi mot thu muc khong dung - dung ra phai bao
# hong ngay. So bang chuoi rong thi hai ben cung $null, van khong nham lan.
$newResolved = (Resolve-Path $NewDir -ErrorAction SilentlyContinue).Path
$oldResolved = (Resolve-Path $OldDir -ErrorAction SilentlyContinue).Path
if ($newResolved -and $oldResolved -and $newResolved -eq $oldResolved) {
  $current = Get-AppVersion $OldDir
  Say "Ban dang chay:  v$current" 'White'
  Say 'Dang hoi GitHub xem co ban moi khong...'

  # Windows 10 doi cu mac dinh con TLS 1.0 -> GitHub tu choi, loi rat kho hieu
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  # Thanh tien trinh cua Invoke-WebRequest lam file 44 MB tai cham hang chuc lan
  $ProgressPreference = 'SilentlyContinue'
  $ua = @{ 'User-Agent' = '1900Retrofoto-CapNhat' }

  try {
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" `
      -Headers $ua -TimeoutSec 30 -ErrorAction Stop
  } catch {
    Stop-Here ("Khong hoi duoc GitHub: $($_.Exception.Message)`n" +
      "  May nay co vao mang duoc khong? Neu khong, tai $AssetName bang may khac,`n" +
      "  chep sang day, giai nen, roi chay CAP-NHAT.bat TRONG thu muc vua giai nen.")
  }

  $latest = [string]$rel.tag_name -replace '^v', ''
  Say "Ban moi nhat:   v$latest" 'White'

  if (-not (Test-NewerVersion $latest $current)) {
    Write-Host ""
    Say "DANG DUNG BAN MOI NHAT (v$current). Khong co gi de cap nhat." 'Green'
    Write-Host ""
    Say 'Nhan Enter de dong cua so nay.'
    [void](Read-Host)
    exit 0
  }

  $asset = @($rel.assets | Where-Object { $_.name -eq $AssetName })[0]
  if (-not $asset) {
    Stop-Here "Ban v$latest tren GitHub khong kem file $AssetName. Bao nguoi lam phan mem."
  }

  $mb = [math]::Round($asset.size / 1MB, 1)
  Write-Host ""
  Say "Co ban moi: v$current  ->  v$latest  (tai ve $mb MB)" 'Yellow'
  Say 'Cau hinh va toan bo anh khach se GIU NGUYEN.' 'Green'
  Say 'Server se tat khoang 1-2 phut. Dung cap nhat khi con khach dang chup.' 'Yellow'
  Write-Host ""
  if (-not $Yes) {
    $ans = Read-Host "  Go 'c' roi Enter de tai ve va cap nhat (Enter khong de huy)"
    if ($ans -ne 'c') {
      Write-Host ""
      Say 'Da huy. Khong co gi thay doi.'
      Write-Host ""
      Say 'Nhan Enter de dong cua so nay.'
      [void](Read-Host)
      exit 0
    }
  }

  # Tai va giai nen o %TEMP% chu khong canh thu muc cai dat: giai nen do
  # hong nua chung thi ban dang chay van nguyen ven.
  $work = Join-Path $env:TEMP "1900Retrofoto-capnhat-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  New-Item -ItemType Directory -Path $work -Force | Out-Null
  $zipPath = Join-Path $work $AssetName

  Write-Host ""
  Say "Dang tai v$latest ($mb MB)... co the mat vai phut."
  try {
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath `
      -Headers $ua -TimeoutSec 900 -ErrorAction Stop
  } catch {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
    Stop-Here "Tai that bai: $($_.Exception.Message)`n  Kiem tra mang roi thu lai."
  }
  Say '[ok] Da tai xong' 'Green'

  Say 'Dang giai nen...'
  try {
    Expand-Archive -Path $zipPath -DestinationPath $work -Force -ErrorAction Stop
  } catch {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
    Stop-Here "Giai nen that bai: $($_.Exception.Message)"
  }

  # ZIP hien dong kem thu muc goc '1900Retrofoto', nhung do la chi tiet cua
  # khau dong goi chu khong phai hop dong - tim theo DAU HIEU de doi cach nen
  # cung khong hong.
  $pkg = @(@($work) + @(Get-ChildItem $work -Directory | ForEach-Object { $_.FullName }) |
    Where-Object {
      (Test-Path (Join-Path $_ 'package.json')) -and (Test-Path (Join-Path $_ 'server'))
    })[0]
  if (-not $pkg) {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
    Stop-Here "File tai ve khong dung dinh dang goi cai dat. Bao nguoi lam phan mem."
  }
  Say '[ok] Da giai nen' 'Green'

  <#
    Giao viec thay file cho script CUA BAN MOI, khong tu lam tiep.

    Hai cai loi:
      - Ban moi co the doi cach cap nhat (them buoc chuyen doi du lieu chang
        han); giao cho no thi ban cu khong can biet truoc dieu do.
      - Script dang chay nam trong thu muc sap bi xoa. PowerShell doc het file
        vao bo nho truoc khi chay nen xoa giua chung van an toan, nhung de mot
        tien trinh khac lam thi khong phai dua vao chi tiet do.
  #>
  Write-Host ""
  Say 'Dang chuyen sang ban moi de thay file...'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass `
    -File (Join-Path $pkg 'cap-nhat.ps1') -NewDir $pkg -OldDir $OldDir -Yes
  $code = $LASTEXITCODE
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
  exit $code
}

# ---------------------------------------------------------------------------
# 4. Che do TAY: da co san goi moi o $NewDir
# ---------------------------------------------------------------------------
#
# Den day ma $NewDir khong tro toi dau la sai tham so, khong phai goi thieu
# file. Noi thang thay vi de vong lap duoi bao "thieu thu muc 'server'" - hai
# nguyen nhan khac han nhau ma cach sua cung khac han.
if (-not $newResolved) {
  Stop-Here "Khong thay thu muc goi moi: '$NewDir'. Giai nen lai roi chay CAP-NHAT.bat TRONG thu muc vua giai nen."
}

foreach ($d in $CodeDirs) {
  if (-not (Test-Path (Join-Path $NewDir $d))) {
    Stop-Here "Thu muc moi thieu '$d' -> giai nen chua xong hoac sai thu muc. Giai nen lai roi thu lai."
  }
}

$port = Get-ServerPort $OldDir
$verOld = Get-AppVersion $OldDir
$verNew = Get-AppVersion $NewDir

Write-Host ""
Say "Ban dang chay:  v$verOld   ($OldDir)" 'White'
Say "Ban se cai:     v$verNew   ($NewDir)" 'White'

# Chay tay thi rat de cam nham goi cu - noi thang thay vi lang le lui ban ve
if (-not (Test-NewerVersion $verNew $verOld)) {
  Write-Host ""
  Say "Goi nay KHONG moi hon ban dang chay (v$verNew so voi v$verOld)." 'Yellow'
  Say 'Co the ban cam nham thu muc cu. Kiem tra lai truoc khi tiep tuc.' 'Yellow'
}

if (-not $Yes) {
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
}

# --- 5. Sao luu cau hinh TRUOC khi dung vao gi ---
#
# Mat .env.local la mat mat khau va dia chi in vao ma QR -> phai co ban sao
# nam ngoai thu muc sap bi ghi de, phong khi cap nhat dut giua chung.
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $env:TEMP "1900Retrofoto-env-$stamp.bak"
Copy-Item $envPath $backup -Force
Write-Host ""
Say "[ok] Da sao luu cau hinh: $backup" 'Green'

# --- 6. Dung server ---
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

# --- 7. Thay file chuong trinh ---
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

# --- 8. Tra lai cau hinh ---
#
# Buoc 7 co the da xoa .env.local neu ban moi tinh co cung ten file, nen
# chep lai tu ban sao thay vi tin rang no con nguyen.
Copy-Item $backup $envPath -Force
Say '[ok] Da giu nguyen cau hinh cu' 'Green'

# --- 9. Bat lai ---
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
  # In so phien ban server VUA BAO VE, khong in lai so doc tu file luc nay -
  # day la bang chung server that su dang chay code moi, chu khong phai chi
  # la "da chep file xong".
  $ran = if ($health.version) { $health.version } else { $verNew }
  Write-Host "  XONG. Da cap nhat v$verOld -> v$ran, server dang chay." -ForegroundColor Green
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
