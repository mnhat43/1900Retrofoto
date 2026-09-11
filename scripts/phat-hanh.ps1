# PHAT HANH - dua mot phien ban moi len GitHub Releases bang mot lenh.
#
#   powershell -ExecutionPolicy Bypass -File scripts\phat-hanh.ps1 1.3.0
#
# Lam tuan tu: kiem tra -> chay test -> soan ghi chu -> bump so phien ban ->
# dong goi -> nen ZIP -> commit -> tag -> push -> tao release.
#
# MOI KIEM TRA DEU CHAY TRUOC KHI SUA BAT CU FILE NAO. Hong o khau kiem tra
# thi kho ma nguon con nguyen ven, khong phai don dep gi.
#
# Tham so:
#   -NotesFile <duong dan>  Ghi chu phat hanh viet san. Khong co thi script
#                           sinh nhap tu git log roi mo Notepad cho sua.
#   -Title <chuoi>          Tieu de release. Mac dinh "vX.Y.Z".
#   -DryRun                 Lam het o may, KHONG push va KHONG tao release.
#                           Dung de xem thu ZIP truoc khi cong bo.
#   -SkipVerify             Bo qua 'npm run verify' (bo script Playwright,
#                           chay lau). Van chay unit test.
#
# Chi dung ASCII (khong dau) - giu chung quy uoc voi cac script khac.

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Version,
  [string]$NotesFile,
  [string]$Title,
  [switch]$DryRun,
  [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'
$AppDir = Split-Path -Parent $PSScriptRoot
$Tag = "v$Version"
$ZipName = '1900Retrofoto.zip'

function Say([string]$Text, [string]$Color = 'Gray') {
  Write-Host "  $Text" -ForegroundColor $Color
}

function Buoc([string]$Text) {
  Write-Host ""
  Write-Host "  == $Text" -ForegroundColor Cyan
}

function Hong([string]$Message) {
  Write-Host ""
  Write-Host "  HONG: $Message" -ForegroundColor Red
  Write-Host ""
  exit 1
}

<#
  Chay mot lenh ngoai va dung han neu no that bai.

  Phai kiem $LASTEXITCODE bang tay: $ErrorActionPreference khong ap dung cho
  chuong trinh ngoai, nen 'npm test' that bai van chay tiep den buoc push
  neu khong chan o day.
#>
function Chay([string]$What, [scriptblock]$Block) {
  & $Block
  if ($LASTEXITCODE -ne 0) { Hong "$What that bai (ma loi $LASTEXITCODE)." }
}

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host "    1900 RETROFOTO - PHAT HANH $Tag" -ForegroundColor Cyan
Write-Host "  ===============================================" -ForegroundColor Cyan

Push-Location $AppDir
try {

# ---------------------------------------------------------------------------
Buoc '1/8  Kiem tra truoc khi dong vao gi'
# ---------------------------------------------------------------------------

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  Hong "So phien ban phai dang X.Y.Z (vi du 1.3.0), dang nhan '$Version'."
}

$pkgPath = Join-Path $AppDir 'package.json'
$cur = (Get-Content $pkgPath -Raw | ConvertFrom-Json).version
if (-not ([version]$Version -gt [version]$cur)) {
  Hong "Ban moi ($Version) phai lon hon ban hien tai ($cur)."
}
Say "[ok] $cur -> $Version"

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') {
  Hong "Dang o nhanh '$branch'. Chuyen sang main roi phat hanh."
}
Say "[ok] Dang o nhanh main"

<#
  Bat buoc kho sach.

  Neu khong, commit bump phien ban se nuot theo moi thay doi dang do dang -
  release se chua code chua ai xem lai, ma lich su git thi ghi la "chore:
  bump version". Kieu loi nay chi lo ra rat lau sau.
#>
$dirty = git status --porcelain
if ($dirty) {
  Write-Host ""
  $dirty | ForEach-Object { Say "    $_" 'Yellow' }
  Hong 'Kho con thay doi chua commit. Commit hoac stash truoc khi phat hanh.'
}
Say '[ok] Kho sach'

if ((git tag --list $Tag)) { Hong "Tag $Tag da ton tai o may." }
git ls-remote --exit-code --tags origin $Tag 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Hong "Tag $Tag da ton tai tren GitHub." }
Say "[ok] Tag $Tag chua ai dung"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Hong 'Khong tim thay lenh gh. Cai GitHub CLI: https://cli.github.com'
}
gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Hong 'gh chua dang nhap. Chay: gh auth login' }
Say '[ok] gh da dang nhap'

if ($NotesFile -and -not (Test-Path $NotesFile)) {
  Hong "Khong thay file ghi chu: $NotesFile"
}

# ---------------------------------------------------------------------------
Buoc '2/8  Chay test'
# ---------------------------------------------------------------------------
# Chay TRUOC khi bump: test hong thi khong co file nao bi sua, khoi don dep.

Chay 'Unit test' { npx vitest run }
Say '[ok] Unit test dat'

if ($SkipVerify) {
  Say '[bo qua] npm run verify (co -SkipVerify)' 'Yellow'
} else {
  Say 'Dang chay npm run verify... (vai phut, co mo trinh duyet)'
  Chay 'npm run verify' { npm run verify }
  Say '[ok] Verify dat'
}

# ---------------------------------------------------------------------------
Buoc '3/8  Ghi chu phat hanh'
# ---------------------------------------------------------------------------
#
# NGUOI DOC GHI CHU NAY LA NHAN VIEN QUAN, khong phai lap trinh vien - ho mo
# trang Releases de biet "co gi moi" va "cap nhat the nao". Nen khong bao gio
# day thang git log len lam ghi chu; chi dung no lam dan y de viet lai.

if (-not $NotesFile) {
  $draft = Join-Path $AppDir "build\ghi-chu-$Tag.md"
  New-Item -ItemType Directory -Path (Split-Path $draft) -Force | Out-Null

  $prev = git describe --tags --abbrev=0 2>$null
  $range = if ($prev) { "$prev..HEAD" } else { 'HEAD' }
  $log = @(git log $range --pretty=format:'%s' | ForEach-Object { "- $_" })

  @(
    "## Cap nhat the nao",
    "",
    "Nhap dup loi tat **``CAP-NHAT``** ngoai man hinh -> **Yes** -> go ``c`` roi Enter.",
    "",
    "Xong nho bam **Ctrl + Shift + R** o trang quan ly va ca 3 may trong phong chup.",
    "",
    "---",
    "",
    "## Co gi moi",
    "",
    "<!-- VIET LAI CHO NHAN VIEN DOC. Danh sach duoi day chi la dan y tu git log. -->",
    "<!-- Moi muc noi ro: truoc thi sao, gio thi sao, ho phai lam gi khac di. -->",
    ""
  ) + $log | Set-Content $draft -Encoding UTF8

  Say "Da sinh nhap tu $($log.Count) commit: $draft"
  Say 'Dang mo Notepad - sua xong thi LUU va DONG cua so do lai.' 'Yellow'
  Start-Process notepad.exe -ArgumentList $draft -Wait
  $NotesFile = $draft
}

$notesText = (Get-Content $NotesFile -Raw)
if ($notesText -match 'VIET LAI CHO NHAN VIEN DOC') {
  Hong "Ghi chu van con dong nhac viet lai. Sua $NotesFile roi chay lai."
}
if ($notesText.Trim().Length -lt 40) {
  Hong "Ghi chu qua ngan, co ve chua viet. Sua $NotesFile roi chay lai."
}
Say "[ok] Ghi chu: $NotesFile"

# ---------------------------------------------------------------------------
Buoc '4/8  Bump so phien ban'
# ---------------------------------------------------------------------------
#
# Hai cho phai khop nhau, va package-app.ps1 se tu choi dong goi neu lech.
# Sua ca hai o day de khong bao gio phai nho bang tay.

# Sua dung dong "version" thay vi doc-roi-ghi-lai ca JSON: ConvertTo-Json
# doi thu tu khoa va cach thut dong, lam diff cua package.json day rac.
$pkgRaw = [System.IO.File]::ReadAllText($pkgPath)
$pkgNew = $pkgRaw -replace '("version"\s*:\s*")[^"]+(")', "`${1}$Version`${2}"
[System.IO.File]::WriteAllText($pkgPath, $pkgNew, (New-Object System.Text.UTF8Encoding($false)))

# installer.iss dung 2 so dau: "1.3.0" -> "1.3"
$issPath = Join-Path $PSScriptRoot 'installer.iss'
$issShort = $Version -replace '^(\d+\.\d+).*', '$1'
$issRaw = [System.IO.File]::ReadAllText($issPath)
$issNew = $issRaw -replace '(#define AppVersion ")[^"]+(")', "`${1}$issShort`${2}"
[System.IO.File]::WriteAllText($issPath, $issNew, (New-Object System.Text.UTF8Encoding($false)))

Say "[ok] package.json = $Version, installer.iss = $issShort"

# ---------------------------------------------------------------------------
Buoc '5/8  Dong goi va nen ZIP'
# ---------------------------------------------------------------------------

Chay 'Dong goi' {
  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'package-app.ps1')
}

$outDir = Join-Path $AppDir 'build\1900Retrofoto'
$zipPath = Join-Path $AppDir "build\$ZipName"

# Doi chieu lai so phien ban TRONG goi, khong tin rang buoc 4 da ngam.
# Goi sai version la moi may ngoai quan ket o ban cu ma khong bao gi.
$inPkg = (Get-Content (Join-Path $outDir 'package.json') -Raw | ConvertFrom-Json).version
if ($inPkg -ne $Version) { Hong "Goi vua dong ghi v$inPkg chu khong phai v$Version." }

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path $outDir -DestinationPath $zipPath -CompressionLevel Optimal
$mb = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Say "[ok] $ZipName  ($mb MB, chua v$inPkg)"

# ---------------------------------------------------------------------------
Buoc '6/8  Commit va tag'
# ---------------------------------------------------------------------------

Chay 'git add' { git add package.json scripts/installer.iss }
Chay 'git commit' { git commit -m "chore: phat hanh $Tag" }
Chay 'git tag' { git tag -a $Tag -m $Tag }
Say "[ok] Da commit va tag $Tag"

if ($DryRun) {
  Write-Host ""
  Write-Host "  DRY RUN - dung o day, CHUA push va CHUA tao release." -ForegroundColor Yellow
  Write-Host ""
  Say "Goi de xem thu: $zipPath"
  Say 'Muon huy het thi chay:' 'Yellow'
  Say "    git tag -d $Tag; git reset --hard HEAD~1"
  Write-Host ""
  exit 0
}

# ---------------------------------------------------------------------------
Buoc '7/8  Push len GitHub'
# ---------------------------------------------------------------------------

Chay 'git push main' { git push origin main }
Chay 'git push tag' { git push origin $Tag }
Say '[ok] Da push'

# ---------------------------------------------------------------------------
Buoc '8/8  Tao release'
# ---------------------------------------------------------------------------

if (-not $Title) { $Title = $Tag }
Chay 'gh release create' {
  gh release create $Tag $zipPath --title $Title --notes-file $NotesFile
}

Write-Host ""
Write-Host "  XONG. Da phat hanh $Tag." -ForegroundColor Green
Write-Host ""
Say 'Cac may quan gio nhap dup loi tat CAP-NHAT la len duoc ban nay.' 'White'
Write-Host ""

} finally {
  Pop-Location
}
