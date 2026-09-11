# Trinh cai dat co giao dien cho 1900 Retrofoto
#
# Nguoi dung chuot phai CAI-DAT.bat -> Run as administrator -> hien cua so
# nay -> dien vai o -> bam Cai dat. Khong can go lenh, khong can biet gi.
#
# NGUYEN TAC: moi thu co the tu lam thi TU LAM. Cang it viec bat nhan vien
# tu lam trong Windows Settings thi cang it cho sai.
#
# Chi dung ASCII (khong dau) trong file nay.

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$AppDir = $PSScriptRoot
. (Join-Path $PSScriptRoot 'lib-net.ps1')

# --- Kiem tra quyen Administrator ---
# Can quyen nay de mo firewall, tat che do ngu va dang ky tu chay khi bat may
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
# Dung Get-LanIp (loc card ao cua WSL/VirtualBox/VPN) chu khong lay card dau
# tien: chon nham card thi ma QR tro vao noi dien thoai khach khong toi duoc.
$localIp = Get-LanIp
$noLan = $false
if (-not $localIp) {
  # Khong tim duoc card mang. Van cho cai dat tiep (nguoi ta co the dang cai
  # truoc khi keo day mang), nhung PHAI canh bao o hop thoai cuoi: dia chi bia
  # nay se duoc in vao ma QR, va khong ai phat hien ra cho toi khi co khach
  # quet QR khong duoc.
  $localIp = "192.168.1.50"
  $noLan = $true
}

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
$tbCap = Add-Field "Thu muc may anh" "D:\Anh" "Noi phan mem may anh luu anh vao"
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
    $cap = $tbCap.Text.Trim()
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

    # Nhung viec khong bat buoc thanh cong thi gom vao day de bao lai o cuoi,
    # thay vi lam do ca buoc cai dat. Vi du: may khong co Windows Defender,
    # hoac may ao khong cho doi thiet lap nguon.
    $warnings = New-Object System.Collections.ArrayList

    try {
      # --- 1. Tao thu muc ---
      $status.Text = "Dang tao thu muc..."
      $form.Refresh()
      New-Item -ItemType Directory -Path $data -Force | Out-Null
      if ($cap) { New-Item -ItemType Directory -Path $cap -Force | Out-Null }

      # --- 2. Ghi cau hinh ---
      $status.Text = "Dang ghi cau hinh..."
      $form.Refresh()
      $envPath = Join-Path $AppDir ".env.local"
      $conf = Read-EnvLocal $envPath
      $conf['PHOTOBOOTH_DATA'] = $data
      $conf['PHOTOBOOTH_PASSWORD'] = $pass
      $conf['PHOTOBOOTH_PORT'] = $port
      if ($cap) { $conf['PHOTOBOOTH_CAPTURE'] = $cap }

      # PHOTOBOOTH_HOST: dia chi duoc IN VAO MA QR cua khach.
      #
      # Ghi thang vao day thay vi de server tu doan card mang luc chay. Server
      # doan bang cach quet danh sach card, va may nao co WSL / Docker /
      # VirtualBox / VPN deu moc them card ao - doan sai thi QR tro vao dia
      # chi dien thoai khach khong bao gio toi duoc, trong khi trang quan ly
      # tren may chu van mo binh thuong nen khong ai phat hien ra.
      $conf['PHOTOBOOTH_HOST'] = "${localIp}:${port}"
      Write-EnvLocal $envPath $conf

      # --- 3. Mo firewall ---
      $status.Text = "Dang mo firewall..."
      $form.Refresh()
      $rule = "1900 Retrofoto"
      try { Remove-NetFirewallRule -DisplayName $rule -ErrorAction Stop } catch { }

      # Mo cho CA Private VA Public.
      #
      # Ban truoc chi mo Private, va do la mot loi that: Windows rat hay xep
      # WiFi quan vao loai Public (mac dinh khi noi mang moi, hoac khi ai do
      # bam "No" o cau hoi "Allow your PC to be discoverable"). Khi do rule
      # khong ap dung, server chay hoan hao ma dien thoai khach bi firewall
      # chan sach - khong co dau hieu gi de doan ra.
      New-NetFirewallRule -DisplayName $rule -Direction Inbound `
        -LocalPort ([int]$port) -Protocol TCP -Action Allow `
        -Profile Private, Public | Out-Null

      # Va dua luon mang hien tai ve Private cho dung ban chat (mang LAN cua
      # quan, khong phai WiFi san bay). Khong bat buoc thanh cong.
      try {
        $ad = Get-LanAdapter
        if ($ad) {
          Set-NetConnectionProfile -InterfaceAlias $ad.InterfaceAlias `
            -NetworkCategory Private -ErrorAction Stop
        }
      } catch {
        [void]$warnings.Add("Khong dat duoc mang thanh Private (khong sao, firewall da mo ca hai loai).")
      }

      # --- 4. Tat che do ngu ---
      #
      # Truoc day day la viec bat nhan vien tu lam trong Settings, va la viec
      # hay bi bo qua nhat. May chu ngu thi khach quet QR khong ra gi, ma
      # dien thoai khach KHONG danh thuc may duoc - chi nguoi cham chuot moi
      # danh thuc duoc. Nen phai tat gium, khong de ai phai nho.
      $status.Text = "Dang tat che do ngu..."
      $form.Refresh()
      try {
        powercfg /change standby-timeout-ac 0 | Out-Null
        powercfg /change hibernate-timeout-ac 0 | Out-Null
        powercfg /change disk-timeout-ac 0 | Out-Null
        # Man hinh van tat duoc sau 10 phut - do man hinh chu khong phai may
        powercfg /change monitor-timeout-ac 10 | Out-Null

        # Cai dat CA cho luc chay pin (-dc), khong chi luc cam dien (-ac).
        #
        # Vi sao quan trong: neu may chu la laptop thi mat dien no chuyen sang
        # pin - va voi thiet lap mac dinh, no se ngu sau ~15 phut. Dien co lai
        # thi may VAN DANG NGU, ca he thong dung cho toi khi co nguoi cham
        # chuot. Dat 0 thi laptop chay tiep bang pin va vuot qua duoc cac lan
        # mat dien ngan ma khach khong he biet.
        powercfg /change standby-timeout-dc 0 | Out-Null
        powercfg /change hibernate-timeout-dc 0 | Out-Null
        powercfg /change disk-timeout-dc 0 | Out-Null
        powercfg /change monitor-timeout-dc 10 | Out-Null

        # Laptop: dong nap khong duoc lam may ngu. Thiet lap nay nam rieng,
        # cac lenh tren khong voi tay den duoc.
        #   4f971e89-... = nhom "Power buttons and lid"
        #   5ca83367-... = "Lid close action",  0 = Do nothing
        foreach ($mode in @('setacvalueindex', 'setdcvalueindex')) {
          powercfg /$mode SCHEME_CURRENT `
            4f971e89-eebd-4455-a8de-9e59040e7347 `
            5ca83367-6e45-459f-a27b-476b1d01c936 0 | Out-Null
        }
        powercfg /setactive SCHEME_CURRENT | Out-Null
      } catch {
        [void]$warnings.Add("Khong tat duoc che do ngu. Vao Settings > Power > Screen and sleep, dat tat ca thanh Never.")
      }

      # --- 5. Loai thu muc nay khoi Windows Defender ---
      #
      # Defender doi khi cach ly node.exe hoac quet tung anh khach luc ghi,
      # lam cham han viec luu anh. Khong bat buoc thanh cong.
      $status.Text = "Dang cau hinh Windows Defender..."
      $form.Refresh()
      try {
        Add-MpPreference -ExclusionPath $AppDir -ErrorAction Stop
        Add-MpPreference -ExclusionPath $data -ErrorAction Stop
      } catch {
        [void]$warnings.Add("Khong them duoc ngoai le cho Windows Defender (khong bat buoc).")
      }

      # --- 6. Dang ky tu chay + tu cuu ---
      $status.Text = "Dang dang ky tu chay..."
      $form.Refresh()

      $runner = Join-Path $AppDir "Chay-server-am-tham.cmd"
      $watch = Join-Path $AppDir "theo-doi.ps1"

      $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' `
        -LogonType ServiceAccount -RunLevel Highest

      # Tac vu CHINH: chay server.
      #
      # Hai moc bat: khi bat may, va lap lai moi 5 phut. Cai lap lai la thu
      # cuu server khi no chet giua ngay (het RAM, ai do tat cua so den).
      # MultipleInstances=IgnoreNew nghia la dang chay thi lan bat moi bi bo
      # qua - nen 5 phut mot lan khong tao ra hai server cung luc.
      #
      # ExecutionTimeLimit=0 la KHONG gioi han: mac dinh Windows giet tac vu
      # sau 3 ngay, va do dung la kieu loi chi xay ra sau khi da giao may cho
      # quan mot thoi gian dai.
      $act = New-ScheduledTaskAction -Execute $runner -WorkingDirectory $AppDir
      $tBoot = New-ScheduledTaskTrigger -AtStartup
      # Khong truyen -RepetitionDuration: de trong nghia la LAP MAI MAI
      $tLoop = New-ScheduledTaskTrigger -Once -At (Get-Date) `
        -RepetitionInterval (New-TimeSpan -Minutes 5)
      $setMain = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
        -ExecutionTimeLimit ([TimeSpan]::Zero)

      Register-ScheduledTask -TaskName (Get-TaskName) -Action $act `
        -Trigger @($tBoot, $tLoop) -Settings $setMain -Principal $principal `
        -Force | Out-Null

      # Tac vu THEO DOI: giet server khi no treo.
      #
      # Tac vu chinh chi cuu duoc truong hop tien trinh CHET. Truong hop tien
      # trinh CON SONG ma khong tra loi nua thi Windows van thay "dang chay"
      # va khong lam gi - quan dung ca ngay ma Task Scheduler bao binh thuong.
      # File theo-doi.ps1 goi thu trang kiem tra suc khoe, khong tra loi thi
      # giet, roi tac vu chinh bat lai.
      if (Test-Path $watch) {
        $wact = New-ScheduledTaskAction -Execute 'powershell.exe' `
          -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$watch`"" `
          -WorkingDirectory $AppDir
        $wtrig = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(3) `
          -RepetitionInterval (New-TimeSpan -Minutes 5)
        $wset = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
          -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
          -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

        Register-ScheduledTask -TaskName (Get-WatchTaskName) -Action $wact `
          -Trigger $wtrig -Settings $wset -Principal $principal -Force | Out-Null
      }

      # --- 7. Loi tat ngoai man hinh ---
      $status.Text = "Dang tao loi tat..."
      $form.Refresh()

      # Uu tien man hinh dung chung, lui ve man hinh ca nhan neu khong ghi duoc
      $desktop = Get-WritableDesktop

      # Dung .url chu khong .lnk: day dung la kieu loi tat cho dia chi web
      @('[InternetShortcut]', "URL=http://${localIp}:${port}/staff") |
        Set-Content -Path (Join-Path $desktop '1900 Retrofoto.url') -Encoding ascii
      $stale = Join-Path $desktop '1900 Retrofoto.lnk'
      if (Test-Path $stale) { Remove-Item $stale -Force -ErrorAction SilentlyContinue }

      # Loi tat cuu ho.
      #
      # Tao het ra man hinh chu khong de trong thu muc cai dat: KIEM-TRA.bat
      # in ra loi khuyen kieu "nhap dup SUA-IP.bat", va luc dang co su co thi
      # bat nhan vien di tim thu muc C:\1900Retrofoto la them mot buoc de sai.
      $ws = New-Object -ComObject WScript.Shell
      foreach ($pair in @(
          @('KIEM-TRA (chay khi co van de)', 'KIEM-TRA.bat'),
          @('KHOI-DONG-LAI', 'KHOI-DONG-LAI.bat'),
          @('SUA-IP (khi doi dia chi)', 'SUA-IP.bat'),
          @('DAT-IP-TINH (ghim dia chi)', 'DAT-IP-TINH.bat'),
          # Tro vao THU MUC CAI DAT -> script hieu la che do tu dong: tu hoi
          # GitHub, tu tai ban moi ve. Nhan vien khong phai dong toi trinh
          # duyet hay biet giai nen la gi.
          @('CAP-NHAT (len ban moi)', 'CAP-NHAT.bat')
        )) {
        $target = Join-Path $AppDir $pair[1]
        if (Test-Path $target) {
          $sc = $ws.CreateShortcut((Join-Path $desktop ($pair[0] + '.lnk')))
          $sc.TargetPath = $target
          $sc.WorkingDirectory = $AppDir
          $sc.Save()
        }
      }

      # --- 8. Chay server ---
      $status.Text = "Dang khoi dong server..."
      $form.Refresh()
      [void](Stop-ServerProcess $AppDir)
      Start-Sleep -Seconds 1
      [void](Start-Server $AppDir)

      $health = $null
      for ($i = 1; $i -le 20; $i++) {
        Start-Sleep -Seconds 2
        $health = Test-ServerHealth ([int]$port) 3
        if ($health) { break }
      }

      $status.ForeColor = [System.Drawing.Color]::FromArgb(13, 155, 108)
      $status.Text = "Xong! Dia chi quan ly: http://${localIp}:${port}/staff"

      $nl = [Environment]::NewLine
      $msg = "Cai dat xong." + $nl + $nl +
      "Trang quan ly:  http://${localIp}:${port}/staff" + $nl +
      "Phong 1:        http://${localIp}:${port}/room?p=1" + $nl +
      "Phong 2:        http://${localIp}:${port}/room?p=2" + $nl +
      "Phong 3:        http://${localIp}:${port}/room?p=3" + $nl + $nl

      if ($health) {
        $msg += "Server dang chay." + $nl
      } else {
        $msg += "Server chua tra loi - nhap dup KIEM-TRA.bat de xem vi sao." + $nl
      }

      $msg += "Da tu tat che do ngu va tu dang ky chay lai khi may bat." + $nl + $nl +
      "CON 1 VIEC NEN LAM:" + $nl +
      "Nhap dup DAT-IP-TINH.bat de ghim dia chi co dinh." + $nl +
      "Khong ghim thi mat dien co the doi dia chi, va ma QR da phat" + $nl +
      "cho khach se khong dung duoc nua." + $nl + $nl +
      "KHI CO VAN DE: nhap dup KIEM-TRA.bat (co loi tat ngoai man hinh)."

      if ($noLan) {
        [void]$warnings.Add(
          "CHUA NOI MANG luc cai dat, nen dia chi $localIp chi la tam. " +
          "Noi WiFi xong PHAI nhap dup SUA-IP.bat, khong thi khach khong quet QR duoc.")
      }

      if ($warnings.Count -gt 0) {
        $msg += $nl + $nl + "Luu y:" + $nl + (($warnings | ForEach-Object { "- $_" }) -join $nl)
      }

      [System.Windows.Forms.MessageBox]::Show($msg, "1900 Retrofoto", "OK", "Information") | Out-Null
      $form.Close()
    }
    catch {
      $status.ForeColor = [System.Drawing.Color]::Red
      $status.Text = "Loi: $($_.Exception.Message)"
      $btn.Enabled = $true
    }
  })

[void]$form.ShowDialog()
