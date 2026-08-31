# Trinh cai dat co giao dien cho 1900 Retrofoto
#
# Nguoi dung nhap dup CAI-DAT.bat -> hien cua so nay -> dien vai o -> bam Cai dat.
# Khong can go lenh, khong can biet PowerShell.

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$AppDir = $PSScriptRoot

# --- Kiem tra quyen Administrator ---
# Can quyen nay de mo firewall va dang ky tu chay khi bat may
$admin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $admin) {
  [System.Windows.Forms.MessageBox]::Show(
    "Can chay bang quyen Administrator." + [Environment]::NewLine + [Environment]::NewLine +
    "Chuot phai vao CAI-DAT.bat, chon 'Run as administrator'.",
    "1900 Retrofoto", "OK", "Warning") | Out-Null
  exit 1
}

# --- Doan IP cua may de goi y ---
function Get-LocalIp {
  $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Sort-Object -Property SkipAsSource |
    Select-Object -First 1 -ExpandProperty IPAddress
  if ($ip) { return $ip }
  return "192.168.1.50"
}
$localIp = Get-LocalIp

# --- Dung cua so ---
$form = New-Object System.Windows.Forms.Form
$form.Text = "Cai dat 1900 Retrofoto"
$form.Size = New-Object System.Drawing.Size(520, 430)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::White

$title = New-Object System.Windows.Forms.Label
$title.Text = "1900 RETROFOTO"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 15, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::FromArgb(232, 51, 110)
$title.Location = New-Object System.Drawing.Point(24, 20)
$title.Size = New-Object System.Drawing.Size(400, 32)
$form.Controls.Add($title)

$sub = New-Object System.Windows.Forms.Label
$sub.Text = "Dien thong tin ben duoi roi bam Cai dat."
$sub.Location = New-Object System.Drawing.Point(26, 52)
$sub.Size = New-Object System.Drawing.Size(440, 20)
$sub.ForeColor = [System.Drawing.Color]::Gray
$form.Controls.Add($sub)

# Ham tao mot dong: nhan + o nhap
$y = 90
function Add-Field($label, $default, $hint) {
  $lb = New-Object System.Windows.Forms.Label
  $lb.Text = $label
  $lb.Location = New-Object System.Drawing.Point(26, $script:y)
  $lb.Size = New-Object System.Drawing.Size(150, 22)
  $lb.Font = New-Object System.Drawing.Font("Segoe UI", 9)
  $form.Controls.Add($lb)

  $tb = New-Object System.Windows.Forms.TextBox
  $tb.Text = $default
  $tb.Location = New-Object System.Drawing.Point(180, $script:y)
  $tb.Size = New-Object System.Drawing.Size(290, 24)
  $form.Controls.Add($tb)

  $script:y += 26
  if ($hint) {
    $hl = New-Object System.Windows.Forms.Label
    $hl.Text = $hint
    $hl.Location = New-Object System.Drawing.Point(182, $script:y)
    $hl.Size = New-Object System.Drawing.Size(290, 18)
    $hl.ForeColor = [System.Drawing.Color]::Gray
    $hl.Font = New-Object System.Drawing.Font("Segoe UI", 8)
    $form.Controls.Add($hl)
    $script:y += 18
  }
  $script:y += 8
  return $tb
}

$tbPass = Add-Field "Mat khau nhan vien" "" "Dung de dang nhap trang quan ly"
$tbData = Add-Field "Thu muc luu anh" "D:\photobooth" "Chon o con nhieu dung luong"
$tbCap  = Add-Field "Thu muc may anh" "D:\Anh" "Noi phan mem may anh luu anh vao"
$tbPort = Add-Field "Cong" "8090" "De nguyen neu khong biet"

# --- Nut Cai dat ---
$btn = New-Object System.Windows.Forms.Button
$btn.Text = "Cai dat"
$btn.Location = New-Object System.Drawing.Point(180, 300)
$btn.Size = New-Object System.Drawing.Size(140, 38)
$btn.BackColor = [System.Drawing.Color]::FromArgb(232, 51, 110)
$btn.ForeColor = [System.Drawing.Color]::White
$btn.FlatStyle = "Flat"
$btn.FlatAppearance.BorderSize = 0
$btn.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($btn)

$status = New-Object System.Windows.Forms.Label
$status.Location = New-Object System.Drawing.Point(26, 348)
$status.Size = New-Object System.Drawing.Size(460, 40)
$status.ForeColor = [System.Drawing.Color]::Gray
$form.Controls.Add($status)

$btn.Add_Click({
  $pass = $tbPass.Text.Trim()
  $data = $tbData.Text.Trim()
  $cap  = $tbCap.Text.Trim()
  $port = $tbPort.Text.Trim()

  if ($pass.Length -lt 4) {
    $status.ForeColor = [System.Drawing.Color]::Red
    $status.Text = "Mat khau phai tu 4 ky tu tro len."
    return
  }
  if (-not ($port -match '^\d+$')) {
    $status.ForeColor = [System.Drawing.Color]::Red
    $status.Text = "Cong phai la so."
    return
  }

  $btn.Enabled = $false
  $status.ForeColor = [System.Drawing.Color]::Gray

  try {
    # 1. Tao thu muc
    $status.Text = "Dang tao thu muc..."
    $form.Refresh()
    New-Item -ItemType Directory -Path $data -Force | Out-Null
    if ($cap) { New-Item -ItemType Directory -Path $cap -Force | Out-Null }

    # 2. Ghi cau hinh
    # Dung UTF8 KHONG BOM: PowerShell 5.1 mac dinh them BOM, lam hong
    # dong dau tien khi server doc file
    $status.Text = "Dang ghi cau hinh..."
    $form.Refresh()
    $lines = @(
      "PHOTOBOOTH_DATA=$data",
      "PHOTOBOOTH_PASSWORD=$pass",
      "PHOTOBOOTH_PORT=$port"
    )
    if ($cap) { $lines += "PHOTOBOOTH_CAPTURE=$cap" }
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText(
      (Join-Path $AppDir ".env.local"),
      ($lines -join "`r`n") + "`r`n", $enc)

    # 3. Mo firewall - chi mang Private, khong mo ra internet
    $status.Text = "Dang mo firewall..."
    $form.Refresh()
    $rule = "1900 Retrofoto"
    # Xoa rule cu neu co; chua co thi bo qua, khong phai loi
    try { Remove-NetFirewallRule -DisplayName $rule -ErrorAction Stop } catch { }
    New-NetFirewallRule -DisplayName $rule -Direction Inbound `
      -LocalPort ([int]$port) -Protocol TCP -Action Allow -Profile Private | Out-Null

    # 4. Dang ky tu chay khi bat may
    $status.Text = "Dang dang ky tu chay..."
    $form.Refresh()
    $task = "1900Retrofoto"
    $cmd = Join-Path $AppDir "Chay-server.cmd"

    # KHONG dung "2>&1 | Out-Null" voi lenh native trong PowerShell 5.1:
    # no bien stderr thanh loi thuc su. schtasks /Delete luon ghi ra stderr
    # khi chua co tac vu nao - chuyen binh thuong, nhung se lam hong ca buoc cai.
    # Dung cmd.exe de nuot output, roi tu xet ma tra ve.
    cmd.exe /c "schtasks /Delete /TN $task /F >nul 2>&1"
    cmd.exe /c "schtasks /Create /TN $task /TR `"\`"$cmd\`"`" /SC ONSTART /RU SYSTEM /RL HIGHEST /F >nul 2>&1"
    if ($LASTEXITCODE -ne 0) {
      throw "Khong dang ky duoc tu chay khi bat may (ma loi $LASTEXITCODE)"
    }

    # 5. Shortcut ngoai man hinh
    $ws = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath("Desktop")
    $sc = $ws.CreateShortcut((Join-Path $desktop "1900 Retrofoto.lnk"))
    $sc.TargetPath = "http://${localIp}:${port}/staff"
    $sc.Save()

    $status.ForeColor = [System.Drawing.Color]::FromArgb(13, 155, 108)
    $status.Text = "Xong! Dia chi quan ly: http://${localIp}:${port}/staff"

    [System.Windows.Forms.MessageBox]::Show(
      "Cai dat xong." + [Environment]::NewLine + [Environment]::NewLine +
      "Trang quan ly:  http://${localIp}:${port}/staff" + [Environment]::NewLine +
      "Phong 1:        http://${localIp}:${port}/room?p=1" + [Environment]::NewLine +
      "Phong 2:        http://${localIp}:${port}/room?p=2" + [Environment]::NewLine +
      "Phong 3:        http://${localIp}:${port}/room?p=3" + [Environment]::NewLine +
      [Environment]::NewLine +
      "CON 2 VIEC QUAN TRONG:" + [Environment]::NewLine +
      "1. Dat IP tinh cho may nay (neu IP doi, QR da phat se hong)" + [Environment]::NewLine +
      "2. Tat che do ngu: Settings > Power > Screen and sleep > Never" + [Environment]::NewLine +
      [Environment]::NewLine +
      "Doc HUONG-DAN.txt de biet chi tiet.",
      "1900 Retrofoto", "OK", "Information") | Out-Null

    # Chay server luon
    Start-Process -FilePath $cmd -WorkingDirectory $AppDir
    $form.Close()
  }
  catch {
    $status.ForeColor = [System.Drawing.Color]::Red
    $status.Text = "Loi: $($_.Exception.Message)"
    $btn.Enabled = $true
  }
})

[void]$form.ShowDialog()
