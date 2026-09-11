# 1900 Retrofoto

Hệ thống photobooth chạy **hoàn toàn trong mạng LAN cửa hàng** — không cloud,
không tài khoản bên ngoài, không chi phí. Ảnh không rời khỏi máy chủ của bạn.

> **Dựng trên máy mới?** Làm theo [CAI-DAT.md](CAI-DAT.md) — hướng dẫn từng
> bước, khoảng 30–45 phút. File này thiên về giải thích cách hệ thống hoạt động.
>
> **Đưa cho người không biết code?** Xem [scripts/dong-goi.md](scripts/dong-goi.md)
> — đóng gói thành file `.exe` cài đặt, nhấp đúp là chạy.

## Luồng hoạt động

```
Nhân viên CHỌN PHÒNG + tạo gói chụp  ──►  mã 4 số  ──►  đưa khách
                                                          │
Khách vào đúng phòng đó, nhập mã trên màn hình  ◄─────────┘
              │
          chụp ảnh  ──►  bấm "Đã chụp xong"  ──►  server lấy ảnh từ thư mục
              │
     màn hình hiện 2 mã QR ──► khách quét bằng điện thoại
                                     │
                    ┌────────────────┴────────────────┐
              "Xem ảnh"                        "Ghép khung"
              tải ảnh gốc           chọn khung → chọn ảnh → chỉnh
                                    → lưu → Tải xuống / Chép link
              │
Nhân viên bấm "Đóng phiên"  ──►  phòng rảnh, nhận khách tiếp theo
```

## Mỗi phòng một phiên

Nhân viên **chọn phòng** khi tạo mã. Mã đó **chỉ dùng được ở đúng phòng** đã chọn.

Phòng chỉ rảnh khi nhân viên bấm **"Đóng phiên"** — không tự rảnh khi khách chụp
hoặc ghép xong. Nhờ vậy:

- Không có chuyện phòng nhận khách mới khi lượt trước chưa dứt điểm
- Khách vẫn quét lại QR xem/ghép thêm trong lúc còn ở quán
- Đóng phiên rồi thì QR của khách hết tác dụng (nhân viên vẫn lấy hộ được
  ảnh qua trang quản lý)

Trang nhân viên hiện trạng thái từng phòng: **Trống** hoặc đang giữ mã nào,
kèm nút Đóng phiên.

## Chạy thử trên máy dev

```bash
npm install
npm run build       # build 4 giao diện
npm start           # chạy server ở cổng 8080
```

Mở http://localhost:8080/staff (mật khẩu mặc định: `photobooth`).

Muốn sửa giao diện có hot-reload: chạy `npm start` ở một cửa sổ và `npm run dev`
ở cửa sổ khác, rồi mở cổng 5173 — Vite tự chuyển tiếp `/api` sang server.

## Cài trên máy chủ Windows

Mở PowerShell **bằng quyền Administrator**:

```powershell
npm install
npm run build
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
```

Script sẽ: mở firewall (cả Private và Public), ghi `PHOTOBOOTH_HOST` vào
`.env.local`, tạo tác vụ tự chạy khi khởi động máy, và in ra địa chỉ cho
từng phòng.

> **Đây là đường cài dành cho người có mã nguồn.** Giao cho quán thì dùng gói
> đóng sẵn (xem [scripts/dong-goi.md](scripts/dong-goi.md)) — gói đó tự tắt
> chế độ ngủ, tự đăng ký watchdog, và có `KIEM-TRA.bat` để nhân viên tự chẩn
> đoán.

**Sau khi cài, còn 4 việc bạn phải tự làm:**

1. **Đặt IP tĩnh** cho máy chủ — nếu IP đổi thì QR đã phát cho khách sẽ hỏng.
   Nhanh nhất: `powershell -ExecutionPolicy Bypass -File scripts\dat-ip-tinh.ps1`
   (đọc lại đúng bộ số máy đang chạy tốt rồi ghim y nguyên, tự trả lại DHCP
   nếu mất mạng)
2. **Tắt chế độ ngủ**: Settings → Power → Screen and sleep → Never
3. **Bật sao lưu** thư mục dữ liệu sang ổ ngoài — ổ cứng hỏng là mất hết ảnh,
   không có bản sao nào khác
4. Trên mỗi PC phòng, tạo shortcut Chrome kiosk:

   ```
   chrome.exe --kiosk --incognito --disable-extensions http://<IP-máy-chủ>:8090/room?p=1
   ```

   `--incognito` để mỗi lượt khách bắt đầu sạch (không dính cache lượt trước,
   tốt cho quyền riêng tư) và tránh l ỗi Chrome tự ép HTTPS.

## Sau khi cài xong

Script chỉ **đăng ký** để server tự chạy khi khởi động máy — nó không bật server
ngay. Muốn chạy luôn: nhấp đúp `start-server.cmd` (để cửa sổ đó mở, tắt là server dừng).

> Lần đầu chưa có `start-server.cmd`: chép `start-server.example.cmd` thành
> `start-server.cmd` rồi sửa đường dẫn và **đổi mật khẩu**. File thật không
> nằm trong git vì chứa mật khẩu của quán.

Sau khi khởi động lại máy thì server tự chạy, không cần làm gì.

### Gỡ khỏi máy

```powershell
powershell -ExecutionPolicy Bypass -File scripts\go-cai-dat.ps1
```

Dừng server, bỏ tác vụ tự chạy (cả `PhotoBoothStudio` của bản cài cũ), đóng
firewall, trả lại chế độ ngủ mặc định và IP động, xoá lối tắt cùng
`.env.local`.

**Ảnh khách được giữ nguyên** — script chỉ in đường dẫn ra. Muốn xoá luôn thì
thêm `-XoaDuLieu`, và còn phải gõ đúng tên thư mục để xác nhận.

### Trang trắng, không load được?

Nếu mở bằng Chrome thường bị treo nhưng **tab ẩn danh vào được**, là do Chrome
tự ép HTTPS cho địa chỉ này. Sửa:

1. `chrome://net-internals/#hsts` → mục *Delete domain security policies* →
   nhập IP máy chủ → Delete
2. `chrome://settings/security` → Advanced → tắt *Always use secure connections*
3. Tải lại bằng `Ctrl + Shift + R`

### Cổng bị chiếm

Nhiều máy đã có Apache/XAMPP/IIS giữ cổng 8080. Script sẽ báo và dừng — chọn
cổng khác: `-Port 8090`

## ⚠️ Giới hạn cần biết

> **Khách phải tải ảnh trước khi rời quán.** Hệ thống chỉ chạy trong WiFi cửa
> hàng, ra khỏi WiFi là link không mở được nữa.

Đã có sẵn các cách giảm nhẹ: màn hình phòng và trang khách đều nhắc rõ; nhân
viên tra lại được ảnh cũ trong 7 ngày để lấy hộ khách quên tải.

Nếu muốn khách xem được từ nhà: thêm Cloudflare Tunnel — kiến trúc không phải sửa gì.

## Cấu hình

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PHOTOBOOTH_DATA` | `./photobooth-data` | Thư mục chứa database và ảnh |
| `PHOTOBOOTH_PASSWORD` | `photobooth` | Mật khẩu trang nhân viên — **phải đổi** |
| `PHOTOBOOTH_PORT` | `8080` | Cổng |
| `PHOTOBOOTH_ROOMS` | `1,2,3` | Danh sách phòng |
| `PHOTOBOOTH_RETENTION_DAYS` | `7` | Số ngày giữ ảnh |
| `PHOTOBOOTH_CODE_TTL` | `120` | Mã 4 số hết hạn sau bao nhiêu phút |
| `PHOTOBOOTH_CAPTURE` | *(trống)* | Thư mục gốc nơi máy ảnh lưu ảnh — xem mục dưới |
| `PHOTOBOOTH_HOST` | *(tự dò)* | `ip:cổng` in vào mã QR. **Nên ghim** — xem mục dưới |
| `PHOTOBOOTH_DISK_WARN_GB` | `20` | Còn dưới mức này thì đèn ổ đĩa vàng |
| `PHOTOBOOTH_DISK_CRIT_GB` | `5` | Còn dưới mức này thì đèn ổ đĩa đỏ |

Đặt trong file `.env.local` ở thư mục gốc (script cài đặt tự tạo).

## Ảnh lưu ở đâu

Cấu trúc thư mục đọc được bằng File Explorer, không cần công cụ gì:

```
D:\photobooth\
  data.db
  2026-08-31\
    4829\
      originals\  01.jpg 02.jpg ...   ← ảnh gốc
      previews\   01.jpg ...          ← bản 1400px cho điện thoại
      strips\     strip-1.png         ← ảnh đã ghép khung
```

Job dọn dẹp chạy mỗi 6 giờ, xoá thư mục quá hạn giữ. Bản ghi trong database
được giữ lại (đánh dấu đã xoá) để nhân viên còn tra được lịch sử.

Ngoài job tự động, trang nhân viên có tab **Ổ đĩa** hiện dung lượng còn trống
và cho dọn theo mốc tuổi ảnh (30/14/7/3 ngày), mỗi mốc ghi rõ sẽ xoá bao nhiêu
phiên và giải phóng bao nhiêu GB trước khi bấm. Phiên đang chiếm phòng
(`created`/`active`/`shooting`) không bao giờ bị xoá, kể cả khi đã quá mốc.

## Vì sao phải ghim `PHOTOBOOTH_HOST`

Mã QR đưa cho khách được dựng từ địa chỉ LAN của máy chủ. Nếu để server tự dò,
nó quét danh sách card mạng — và máy nào có WSL, Docker, VirtualBox hay VPN đều
mọc thêm card ảo (`172.x`, `192.168.56.x`).

Chọn nhầm card là kiểu hỏng tệ nhất của hệ thống này: server chạy hoàn hảo,
trang quản lý mở bình thường, log không có lỗi nào — nhưng **điện thoại khách
không bao giờ vào được**, và không có dấu hiệu gì để đoán ra.

`lanAddress()` trong `server/index.ts` đã lọc card ảo theo tên và chấm điểm ưu
tiên dải LAN, nhưng đó chỉ là phương án dự phòng. Nguồn đáng tin là
`PHOTOBOOTH_HOST` do trình cài đặt ghi vào — và `SUA-IP.bat` ghi lại khi IP đổi.

## Bảo mật mã 4 số

Mã 4 số chỉ có 10.000 khả năng — quá ít để bảo vệ ảnh chân dung. Nên mã được
tách làm hai vai trò:

| | Mã 4 số | Token trong QR |
|---|---|---|
| Dùng để | Mở khoá phòng chụp | Xem và ghép ảnh |
| Ở đâu | Tại chỗ, PC phòng | Điện thoại khách |
| Độ dài | 4 chữ số | 256 bit |
| Vòng đời | Dùng 1 lần, hết hạn 2h | Hết hạn cùng phiên (7 ngày) |

Mã là **vé vào cửa, không phải mật khẩu** — phòng nhận mã xong thì mã hết tác
dụng ngay. Kèm theo: khoá 60s sau 5 lần nhập sai (theo từng phòng), mã sai và
mã hết hạn trả về giống hệt nhau, loại các mã dễ đoán (`0000`, `1234`...).

## Bố cục khung ảnh

Chọn số ô là ra khổ giấy tương ứng:

| Số ô | Lưới | Khổ giấy | Pixel @300 DPI |
|---|---|---|---|
| 3 | 1 × 3 | 2×6 inch | 600 × 1800 |
| 4 | 1 × 4 | 2×6 inch | 600 × 1800 |
| 6 | 2 × 3 | 4×6 inch | 1200 × 1800 |
| 9 | 3 × 3 | 6×6 inch | 1800 × 1800 |

### Thêm khung mới

**1. File PNG** → `public/frames/<id>.png`, đúng khổ ở bảng trên, chỗ nào muốn
lộ ảnh thì để **trong suốt**. PNG vẽ đè lên ảnh nên hoa văn tự động che mép ảnh.

**2. Khai báo** → `src/frames/index.ts`. Dùng lưới chuẩn thì một dòng:

```ts
preset('my-frame', 'Tên hiển thị', 6, ['phim', 'kpop'])
```

Toạ độ ô là **chuẩn hoá 0..1** so với khổ giấy, nên không phụ thuộc DPI.

## Thiết kế

Bảng màu lấy từ **ba lớp mực của phim màu** — magenta là accent chính, cyan
là accent phụ, trung tính ngả tím nhẹ để hoà với accent (không dùng xám thuần).

| Token | Mã màu | Dùng ở đâu |
|---|---|---|
| `--magenta` | `#e8336e` | Accent chính — nút, mã phiên, trạng thái đang dùng |
| `--cyan` | `#00a9c4` | Accent phụ — mẹo, trạng thái đang chụp |
| `--ink` | `#1a1720` | Nền tối (tím-đen) |
| `--paper` | `#fdfbf7` | Nền sáng, ngả ấm |

Chữ: **Bricolage Grotesque** (tiêu đề), **Be Vietnam Pro** (nội dung — thiết kế
riêng cho tiếng Việt nên dấu đẹp), **JetBrains Mono** (mã 4 số, giờ).

Toàn bộ token nằm ở [src/ui/brand.css](src/ui/brand.css). Ba giao diện đều
`@import` file này nên đổi màu một chỗ là đổi cả hệ thống.

**Màn hình phòng và trang khách LUÔN SÁNG** — tông tươi tắn với hai quầng màu
rất nhạt (magenta trên trái, cyan dưới phải). Không theo chế độ tối của máy:
đây là mặt thương hiệu khách nhìn, hai người đứng cạnh nhau phải thấy giống
nhau. Chỉ **trang nhân viên** theo chế độ sáng/tối của máy.

Logo hiện ở **mọi màn hình**, kể cả màn QR và các bước ghép khung.

## Kiến trúc

```
server/          Node server (SQLite + ảnh trên ổ cứng)
src/ui/brand.css ★ hệ thiết kế dùng chung (màu, chữ, nút)
src/
  core/          ★ toán hình học — bất biến theo scale
  render/        ★ vẽ và chỉnh màu — dùng chung preview + export
  media/         nạp ảnh từ File hoặc URL
  frames/        thư viện khung
  ui/room/       màn hình phòng
  ui/studio/     giao diện khách (điện thoại)
  ui/staff/      trang nhân viên
```

4 entry point riêng thay vì router chung — điện thoại khách không phải tải kèm
dashboard nhân viên. Màn hình phòng chỉ 4.4KB.

**Vì sao preview khớp file xuất:** toạ độ ô lưu chuẩn hoá 0..1, vị trí ảnh lưu
bằng `zoom` + `offset` theo tỉ lệ phần thừa (không phải pixel). Nhân kích thước
với hệ số *k* bất kỳ thì mọi kết quả nhân đúng *k*. Preview và export gọi **cùng
một hàm**, chỉ khác tham số kích thước.

Ảnh ghép được render **trên điện thoại khách**, không phải server — nếu render
ở server sẽ thành hai bản cài đặt của cùng phép toán, và đảm bảo trên mất hiệu lực.

## Kiểm chứng

```bash
npm test              # 111 unit test (toán hình học, sinh mã, chống dò, dọn dẹp)
npm run verify        # chạy tất cả kiểm chứng bên dưới
```

| Lệnh | Kiểm gì |
|---|---|
| `verify:export` | Preview khớp export ở mọi khung — yêu cầu lệch **0** |
| `verify:photos` | Ảnh nạp từ server cho pixel **trùng khít** ảnh nạp từ máy |
| `verify:api` | 27 kiểm tra API gồm cả bảo mật (token, chống dò, phân quyền) |
| `verify:flow` | Trọn luồng bằng trình duyệt thật: NV → phòng → khách → file trên đĩa |
| `verify:rooms` | Mỗi phòng một phiên, đóng phiên mới giải phóng phòng |
| `verify:intake` | Lấy ảnh theo thư mục mã, không lẫn giữa các phiên |
| `verify:cache` | HTML không cache — tránh trình duyệt kẹt bản cũ |
| `verify:noscroll` | Không màn nào bị cuộn ngoài ý muốn (5 cỡ màn) |

`npm run screenshot:flow` chụp 9 màn hình của cả luồng vào `scratch/`.

## Lấy ảnh từ máy chụp

Mỗi phiên có **một thư mục riêng đặt tên bằng mã 4 số**, tạo sẵn ngay khi nhân
viên tạo mã. Khách chụp xong bấm **"Đã chụp xong"**, server quét đúng thư mục đó.

Nhờ mỗi phiên một thư mục, ảnh **không thể lẫn giữa các khách** — kể cả khi hai
phòng chụp cùng lúc.

**Cài đặt:** thêm vào `.env.local`:

```
PHOTOBOOTH_CAPTURE=D:\Anh
```

Luồng làm việc:

```
Nhân viên tạo mã 5680
    -> server tạo D:\Anh.80\  và hiện đường dẫn trên màn hình
    -> nhân viên trỏ phần mềm Canon lưu vào thư mục đó

Khách nhập mã ở phòng -> chụp -> bấm "Đã chụp xong"
    -> server quét D:\Anh.80\ -> ảnh hiện lên -> hiện QR
```

Màn hình phòng hiện sẵn đường dẫn để nhân viên khỏi phải nhớ.

### Hành vi đã kiểm chứng

| Tình huống | Xử lý |
|---|---|
| Thư mục trống | Báo rõ kèm đường dẫn, có nút **Quét lại** — không im lặng bỏ qua |
| Bấm quét nhiều lần | Không nhân đôi ảnh (nhớ theo tên file gốc) |
| Chụp thêm rồi quét lại | Chỉ lấy ảnh mới |
| Vượt số ảnh của gói | Dừng, không nhận thêm |
| File không phải ảnh | Bỏ qua |
| Hai phòng chụp cùng lúc | Mỗi phòng chỉ lấy ảnh thư mục của mình |
| Ảnh gốc trong thư mục | **Không đụng vào** — chỉ đọc, không di chuyển/xoá |

> **Không còn cách thêm ảnh thủ công.** Toàn bộ ảnh vào qua thư mục. Nếu chưa
> đặt `PHOTOBOOTH_CAPTURE`, màn hình phòng báo lỗi rõ và phòng đó không nhận
> được ảnh nào — phải cấu hình xong mới dùng được.

### Chưa cấu hình `PHOTOBOOTH_CAPTURE`?

Màn hình phòng báo **"Hệ thống đang gặp lỗi — vui lòng liên hệ nhân viên"** và
nút "Đã chụp xong" bị khoá.

Màn hình phòng là thứ **khách nhìn**, nên mọi lỗi đều hiện chung chung như vậy:
không lộ đường dẫn thư mục hay tên biến cấu hình. Chi tiết kỹ thuật ghi ở cửa sổ
console của server để nhân viên tra khi cần.

Cách sửa: đặt `PHOTOBOOTH_CAPTURE` trong `.env.local` rồi khởi động lại server.

