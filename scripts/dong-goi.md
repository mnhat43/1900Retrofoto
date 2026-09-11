# Đóng gói thành ứng dụng cài đặt

Dành cho **bạn** (người có mã nguồn), để tạo ra file cài đặt đưa cho người
không biết code.

---

## Tạo gói

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package-app.ps1
```

Xong sẽ có thư mục `build\1900Retrofoto\` (~113MB) chứa đầy đủ mọi thứ,
**kể cả Node.js** — máy đích không cần cài gì trước.

## Tạo file .exe cài đặt

1. Tải **Inno Setup**: <https://jrsoftware.org/isdl.php> (miễn phí)
2. Mở `scripts\installer.iss` bằng Inno Setup
3. Bấm **Build → Compile**

Ra file `build\1900Retrofoto-Setup.exe` (~45MB sau khi nén).

## Cách khác: chỉ nén ZIP

Nếu không muốn cài Inno Setup, nén thẳng thư mục `build\1900Retrofoto`
thành ZIP. Người dùng giải nén rồi chuột phải **CAI-DAT.bat** →
*Run as administrator*.

---

## Người dùng cuối trải nghiệm thế nào

**Với file .exe:**
1. Nhấp đúp `1900Retrofoto-Setup.exe`
2. Bấm Next vài lần
3. Hiện cửa sổ hỏi: mật khẩu, thư mục ảnh, cổng
4. Bấm **Cài đặt** → xong, server chạy luôn

**Trình cài đặt tự làm:**

- Tạo thư mục ảnh, ghi cấu hình (gồm cả `PHOTOBOOTH_HOST` — địa chỉ in vào QR)
- Mở firewall cho **cả** Private và Public, và đưa mạng hiện tại về Private
- Tắt chế độ ngủ + ngủ đông, **cả khi cắm điện và cả khi chạy pin**, và tắt
  "đóng nắp là ngủ" (laptop). Phần chạy pin quan trọng với laptop: mất điện là
  nó chuyển sang pin và mặc định ngủ sau ~15 phút, điện có lại thì máy **vẫn
  đang ngủ** — cả hệ thống đứng cho tới khi có người chạm chuột
- Thêm ngoại lệ Windows Defender cho thư mục cài đặt và thư mục ảnh
- Đăng ký **hai** tác vụ: chạy server (tự bật lại khi chết) và theo dõi
  (giết server khi treo) — xem *Cơ chế tự cứu* bên dưới
- Tạo lối tắt `1900 Retrofoto`, `KIEM-TRA`, `KHOI-DONG-LAI` ngoài màn hình

**Một việc người dùng nên tự làm** (hộp thoại cuối có nhắc): nhấp đúp
`DAT-IP-TINH.bat` để ghim địa chỉ cố định. Script này đọc lại đúng bộ số máy
đang chạy tốt rồi ghim y nguyên, và tự trả lại DHCP nếu mất mạng — nên người
dùng không phải điền số nào.

---

## Cơ chế tự cứu

Hai tác vụ Windows, phân công rõ để không đánh nhau:

| Tác vụ | Chạy gì | Khi nào | Làm gì |
|---|---|---|---|
| `1900Retrofoto` | `Chay-server-am-tham.cmd` | Lúc bật máy + mỗi 5 phút | **Chỉ bật** server. `MultipleInstances=IgnoreNew` nên đang chạy thì lần bật mới bị bỏ qua |
| `1900Retrofoto-TheoDoi` | `theo-doi.ps1` | Mỗi 5 phút | **Chỉ giết** server khi treo |

Vì sao cần cả hai: tác vụ chính chỉ cứu được trường hợp tiến trình **chết**.
Trường hợp tiến trình **còn sống mà không trả lời nữa** thì Windows vẫn thấy
tác vụ "đang chạy" và không làm gì — quán đứng cả ngày mà Task Scheduler báo
bình thường. `theo-doi.ps1` gọi thử `/api/health` ba lần, không trả lời thì
giết, rồi tác vụ chính bật lại.

`theo-doi.ps1` chỉ giết khi tiến trình đã chạy **hơn 2 phút** — dưới ngưỡng đó
rất có thể nó đang khởi động, giết lúc đó sẽ thành vòng lặp giết-bật vô tận.

> ⚠️ `Chay-server-am-tham.cmd` **tuyệt đối không được có `pause`**. Tác vụ chạy
> quyền SYSTEM, không có ai bấm phím, nên `pause` sẽ treo mãi mãi — và khi đó
> Windows coi tác vụ là "đang chạy", cơ chế tự bật lại không bao giờ kích hoạt
> được. `Chay-server.cmd` (bản nhân viên nhấp đúp) thì *có* `pause` để đọc lỗi.

---

## Gói có gì

| Thứ | Vì sao cần |
|---|---|
| `runtime\node.exe` | Node nhúng sẵn — máy đích không cần cài |
| `server\`, `src\` | Mã nguồn chạy trực tiếp bằng `--experimental-strip-types` |
| `dist\` | Giao diện đã build |
| `node_modules\` | Chỉ thư viện lúc chạy (`sharp`, `qrcode`) |
| `CAI-DAT.bat` | Người dùng nhấp đúp cái này |
| `Chay-server.cmd` | Chạy tay khi cần — **có** `pause` |
| `Chay-server-am-tham.cmd` | Task Scheduler chạy — **không** `pause` |
| `Mo-trang-quan-ly.cmd` | Mở trang nhân viên, đọc địa chỉ từ `.env.local` |
| `lib-net.ps1` | Hàm dùng chung — các script khác dot-source nó |
| `theo-doi.ps1` | Watchdog, giết server khi treo |
| `KIEM-TRA.bat` | Tự chẩn đoán, in ra đúng việc cần làm |
| `KHOI-DONG-LAI.bat` | Bật lại server |
| `SUA-IP.bat` | Ghim lại địa chỉ sau khi IP đổi |
| `DAT-IP-TINH.bat` | Chuyển DHCP sang IP tĩnh, có đường lùi |
| `CAP-NHAT.bat` | Chép bản mới đè bản đang chạy, giữ nguyên cấu hình |

Năm file `.bat` cuối **tự xin quyền Administrator** (`Start-Process -Verb
RunAs`) thay vì bắt nhân viên nhớ chuột phải.

`react` và `react-dom` bị loại — chỉ dùng lúc build, không cần khi chạy.

---

## Cập nhật bản mới

Phía bạn: bump version → đóng gói → nén ZIP → tag → `gh release create`.
Xem *Phát hành một bản* bên dưới.

Phía quán: **không phải làm gì cả ngoài nhấp đúp lối tắt `CAP-NHAT`**. Script
hỏi `releases/latest` của GitHub, so với `version` trong `package.json` của
bản đang cài, có bản mới thì tự tải ZIP về `%TEMP%`, giải nén và thay.

### Hai chế độ của `CAP-NHAT`

Script tự nhận ra đang ở chế độ nào bằng cách so thư mục chứa nó với thư mục
cài đặt:

| Thư mục chứa script | Chế độ | Làm gì |
|---|---|---|
| Chính thư mục cài đặt (lối tắt trỏ vào đây) | **Tự động** | Hỏi GitHub, tải, giải nén, rồi gọi lại chính nó ở chế độ tay |
| Một thư mục vừa giải nén | **Tay** | Thay file luôn từ đó. Dùng khi quán không ra Internet |

Ở chế độ tự động nó **giao việc thay file cho `cap-nhat.ps1` của bản MỚI**
(`-NewDir <temp> -OldDir <cài đặt> -Yes`), không tự làm tiếp. Nhờ vậy bản mới
đổi cách cập nhật thì bản cũ không cần biết trước.

### Những chỗ dễ hỏng mà script phải lo

- **Chép đè bằng tay là mất `.env.local`** — mất mật khẩu và mất địa chỉ in
  vào mã QR, mà triệu chứng chỉ là "server không lên". Script sao lưu file đó
  ra `%TEMP%` **trước** khi động vào bất cứ thứ gì, và khôi phục từ bản sao
  chứ không tin là nó còn nguyên.
- **Watchdog nhảy vào giữa chừng** — tắt **cả hai** tác vụ Windows trước khi
  chép, bật lại sau (kể cả khi thất bại).
- **`Copy-Item -Recurse` vào thư mục đang tồn tại** chép *lồng vào trong*
  (`dist\dist\...`) chứ không ghi đè → xoá đích trước rồi mới chép.
- **TLS 1.2** — Windows 10 đời cũ mặc định còn TLS 1.0, GitHub từ chối.
- **`$ProgressPreference`** — thanh tiến trình làm `Invoke-WebRequest` tải
  file 44 MB chậm hàng chục lần.

### Version là thứ load-bearing

`CAP-NHAT` so `package.json` với tag GitHub để quyết định có cập nhật không.
**Quên bump `package.json` là mọi máy ngoài quán kẹt ở bản cũ vĩnh viễn** mà
không báo gì — nó chỉ lặng lẽ nói *"đang dùng bản mới nhất"*.

`package-app.ps1` chặn ngay tại khâu đóng gói: từ chối chạy nếu `package.json`
còn `0.0.0`, hoặc nếu hai số đầu không khớp `AppVersion` trong `installer.iss`.

Số này hiện ở ba chỗ để đối chiếu: góc trên trang nhân viên, dòng đầu của
`KIEM-TRA`, và `/api/health`.

**Dữ liệu khách an toàn:** ảnh, database và khung ảnh nhân viên tải lên đều
nằm ở thư mục riêng theo `PHOTOBOOTH_DATA` (ví dụ `D:\photobooth`), không nằm
trong thư mục cài đặt. Gỡ cài đặt cũng không đụng vào.

---

## Phát hành một bản

```powershell
# 1. Bump: package.json "version" = 1.3.0  va installer.iss AppVersion = "1.3"
# 2. Kiem tra
npm run build; npx vitest run; npm run verify

# 3. Dong goi (tu chan neu hai so tren lech nhau)
powershell -ExecutionPolicy Bypass -File scripts\package-app.ps1
Compress-Archive -Path build\1900Retrofoto -DestinationPath build\1900Retrofoto.zip -CompressionLevel Optimal

# 4. Phat hanh
git tag -a v1.3.0 -m "..."; git push origin main; git push origin v1.3.0
gh release create v1.3.0 build\1900Retrofoto.zip --title "..." --notes-file <file>
```

> ⚠️ Tên asset phải đúng `1900Retrofoto.zip`. `CAP-NHAT` tìm asset theo tên
> này; đặt khác là mọi máy báo *"bản mới không kèm file 1900Retrofoto.zip"*.

---

## Vì sao không dùng `pkg` hay `nexe`

Hai công cụ đó gộp Node + mã nguồn thành **một** file `.exe` duy nhất, nghe
gọn hơn. Nhưng dự án này dùng:

- **`sharp`** — có file nhị phân native, `pkg` hay hỏng ở khâu này
- **`node:sqlite`** — mô-đun có sẵn trong Node 22, `pkg` chưa hỗ trợ
- **`--experimental-strip-types`** — chạy thẳng TypeScript, cần Node thật

Chép nguyên `node.exe` vào gói tuy nặng hơn nhưng **chắc chắn chạy**, và
dễ sửa khi có sự cố.
