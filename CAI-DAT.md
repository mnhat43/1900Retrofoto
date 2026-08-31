# Cài đặt trên máy mới

Hướng dẫn từng bước để dựng lại toàn bộ hệ thống trên một máy tính Windows mới.

Làm đúng thứ tự, khoảng **30–45 phút** là xong.

---

## Cần chuẩn bị

| Thứ | Ghi chú |
|---|---|
| Máy tính Windows | Máy chủ, để ở quầy hoặc phòng kỹ thuật. Không cần mạnh |
| Ổ cứng còn trống | Tối thiểu 50GB cho ảnh khách |
| WiFi của quán | Máy chủ, PC phòng và điện thoại khách phải **cùng một mạng** |
| Mã nguồn | Chép từ USB, hoặc `git clone` nếu bạn đã đẩy lên GitHub |

> **Không cần internet để chạy.** Chỉ cần mạng lúc cài Node.js. Sau đó hệ
> thống chạy hoàn toàn trong mạng nội bộ của quán.

---

## Bước 1 — Cài Node.js

1. Vào <https://nodejs.org> → tải bản **LTS** (phải từ **phiên bản 22** trở lên)
2. Chạy file cài, bấm Next tới hết
3. Mở **PowerShell** và kiểm tra:

```powershell
node -v
```

Phải hiện `v22.x.x` hoặc cao hơn. Nếu báo lỗi "không nhận lệnh", khởi động
lại máy rồi thử lại.

---

## Bước 2 — Chép mã nguồn vào máy

Đặt ở đâu cũng được, ví dụ `E:\photobook`. Bài này lấy đường dẫn đó làm ví dụ.

```powershell
cd E:\photobook
npm install
npm run build
```

`npm install` tải thư viện — bước này **cần internet** và mất vài phút.

---

## Bước 3 — Đặt IP tĩnh cho máy chủ ⚠️

**Đây là bước quan trọng nhất, đừng bỏ qua.**

QR code phát cho khách chứa địa chỉ IP của máy chủ. Nếu IP đổi (mất điện,
khởi động lại router), **mọi QR đã phát sẽ hỏng** và khách không xem được ảnh.

1. Mở **Settings → Network & Internet**
2. Chọn mạng đang dùng (WiFi hoặc Ethernet) → **Edit** ở mục *IP assignment*
3. Chuyển từ **Automatic (DHCP)** sang **Manual**, bật **IPv4**
4. Điền:

   | Ô | Điền gì |
   |---|---|
   | IP address | `192.168.1.50` (chọn số cuối từ 50–99, ít bị trùng) |
   | Subnet mask | `255.255.255.0` |
   | Gateway | IP của router, thường `192.168.1.1` |
   | Preferred DNS | `8.8.8.8` |

5. Lưu, rồi kiểm tra:

```powershell
ipconfig
```

Tìm dòng **IPv4 Address** — phải đúng IP bạn vừa đặt. **Ghi lại số này**,
các bước sau cần dùng.

> Ba số đầu (`192.168.1`) phải giống với các máy khác trong quán. Xem `ipconfig`
> trên một PC phòng để biết. Nếu quán dùng `192.168.0.x` hoặc `192.168.102.x`
> thì sửa lại cho khớp.

---

## Bước 4 — Chạy script cài đặt

Mở PowerShell **bằng quyền Administrator** (chuột phải vào biểu tượng
PowerShell → *Run as administrator*):

```powershell
cd E:\photobook
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 `
  -Port 8090 `
  -DataDir "D:\photobooth" `
  -CaptureDir "D:\Anh" `
  -Password "matkhau-cua-ban"
```

Sửa 4 tham số cho đúng máy bạn:

| Tham số | Nghĩa | Gợi ý |
|---|---|---|
| `-Port` | Cổng chạy | `8090`. Tránh `8080` vì hay bị XAMPP chiếm |
| `-DataDir` | Nơi lưu ảnh khách + database | Chọn ổ còn nhiều chỗ |
| `-CaptureDir` | Nơi phần mềm máy ảnh lưu ảnh | Xem bước 6 |
| `-Password` | Mật khẩu trang nhân viên | **Đổi đi**, đừng để mặc định |

Script sẽ tự động:
- Mở firewall cho cổng đó (chỉ mạng Private, không mở ra internet)
- Tạo file `.env.local` chứa cấu hình
- Tạo `start-server.cmd` để chạy tay
- Đăng ký tự chạy mỗi khi khởi động máy

Cuối cùng nó in ra địa chỉ của từng phòng — **chụp màn hình lại**.

---

## Bước 5 — Chạy thử

```powershell
.\start-server.cmd
```

Cửa sổ đen hiện ra và **phải để nguyên đó** — tắt là server dừng.

Mở trình duyệt vào `http://192.168.1.50:8090/staff` (thay IP của bạn),
đăng nhập bằng mật khẩu vừa đặt. Thấy trang quản lý là xong.

Từ lần khởi động máy sau, server tự chạy, không cần bấm gì.

---

## Bước 6 — Nối phần mềm máy ảnh

Hệ thống lấy ảnh bằng cách **đọc thư mục**, không cần cắm dây trực tiếp.

Cách hoạt động: khi tạo mã cho khách, hệ thống tự tạo thư mục tên đúng bằng
mã đó, ví dụ `D:\Anh\8206\`. Bạn chỉ cần trỏ phần mềm máy ảnh
(EOS Utility, digiCamControl…) lưu ảnh vào thư mục đó.

Khi khách bấm **"Đã chụp xong"**, hệ thống quét thư mục và nạp ảnh vào phiên.

**Cách làm thực tế:** trỏ phần mềm máy ảnh vào thư mục gốc `D:\Anh`, rồi mỗi
lượt khách tạo thư mục con tên bằng mã. Hoặc dùng agent theo dõi thư mục
(xem [README.md](README.md), mục *Lấy ảnh từ máy chụp*) để ảnh tự chảy về.

---

## Bước 7 — Cài PC từng phòng

Trên mỗi máy tính đặt trong buồng chụp, tạo shortcut Chrome:

1. Chuột phải màn hình → **New → Shortcut**
2. Dán vào (sửa IP và số phòng):

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --incognito --disable-extensions http://192.168.1.50:8090/room?p=1
```

3. Phòng 2 đổi `p=1` thành `p=2`, phòng 3 thành `p=3`
4. Chép shortcut vào thư mục khởi động để tự mở khi bật máy:
   - Nhấn `Win + R`, gõ `shell:startup`, Enter
   - Dán shortcut vào thư mục vừa mở

**Vì sao dùng `--kiosk --incognito`:**
- `--kiosk` — toàn màn hình, khách không thoát ra hay mở tab khác được
- `--incognito` — mỗi lượt khách bắt đầu sạch, không dính dữ liệu lượt trước

> Thoát chế độ kiosk bằng `Alt + F4`.

---

## Bước 8 — Ba việc bắt buộc trước khi mở cửa

### Tắt chế độ ngủ

Máy chủ ngủ là cả hệ thống chết.

**Settings → System → Power & battery → Screen and sleep**
→ đặt tất cả thành **Never**.

### Bật sao lưu

**Ổ cứng hỏng là mất toàn bộ ảnh khách, không có bản sao nào khác.**

Cách đơn giản nhất: cắm ổ cứng ngoài, bật **File History** cho thư mục
`D:\photobooth`. Hoặc mỗi tối chép tay thư mục đó sang ổ ngoài.

### Chạy thử trọn luồng

Tự đóng vai khách một lần:

1. Trang nhân viên → tạo mã cho phòng 1
2. Vào PC phòng 1, nhập mã đó
3. Chép vài ảnh vào `D:\Anh\<mã>\`
4. Bấm **"Đã chụp xong"** → hiện 2 QR
5. Dùng điện thoại (**phải nối WiFi quán**) quét QR ghép khung
6. Chọn khung, ghép ảnh, tải về

Chạy trót lọt là hệ thống sẵn sàng.

---

## Chuyển dữ liệu từ máy cũ sang

Nếu bạn đang thay máy chủ và muốn giữ ảnh cũ:

1. Tắt server ở máy cũ (đóng cửa sổ đen, hoặc khởi động lại máy)
2. Chép **toàn bộ** thư mục `D:\photobooth` sang máy mới, giữ nguyên đường dẫn
3. Chép luôn file `.env.local` để giữ nguyên mật khẩu và cấu hình
4. **Đặt IP tĩnh trùng với máy cũ** — như vậy QR đã phát vẫn dùng được

Thư mục đó chứa cả database (`data.db`), ảnh khách, khung ảnh đã tải lên và
bộ chỉnh màu đã lưu.

---

## Gặp trục trặc

### Điện thoại không mở được QR

Kiểm tra theo thứ tự:

1. **Điện thoại có nối WiFi quán không?** Dùng 4G là không vào được — đây là
   hệ thống nội bộ, không ra internet.
2. **Server còn chạy không?** Mở `http://<IP>:8090/staff` trên máy chủ.
3. **IP có đổi không?** Chạy `ipconfig`, so với IP trong QR. Nếu đổi thì bước 3
   chưa làm đúng.

### Trang trắng, không load được

Chrome đang giữ cache cũ. Nhấn `Ctrl + Shift + R`. Nếu vẫn trắng, mở tab ẩn
danh thử lại.

### Cổng bị chiếm

Máy đã có XAMPP hoặc phần mềm khác dùng cổng đó. Chạy lại script cài với cổng
khác, ví dụ `-Port 8095`. Nhớ **tạo lại shortcut PC phòng** với cổng mới.

### Quên mật khẩu nhân viên

Mở `.env.local` ở thư mục gốc bằng Notepad, xem dòng `PHOTOBOOTH_PASSWORD`.
Sửa được luôn, sửa xong khởi động lại server.

### Bấm "Đã chụp xong" mà không thấy ảnh

Ảnh chưa nằm đúng thư mục. Mở File Explorer, kiểm tra `D:\Anh\<mã>\` — tên
thư mục phải **đúng bằng 4 số** của mã, và ảnh phải nằm ngay trong đó.

---

## Vận hành hằng ngày

**Tạo mã cho khách:** trang nhân viên → chọn phòng → chọn số kiểu ảnh →
bấm *Tạo mã* → đọc 4 số cho khách.

**Phòng rảnh khi nào:** ngay khi khách bấm *"Đã chụp xong"*. Khách cũ cầm QR
ra ngoài ngồi ghép ảnh, khách mới vào chụp được luôn — không phải đợi.

**Đóng phiên:** sau khi khách đã tải ảnh về, bấm *Đóng* ở dòng
"đang ghép ảnh". Đóng sớm thì khách mất quyền quét QR.

**Ảnh tự xoá sau 7 ngày.** Đổi số ngày ở `.env.local`, dòng
`PHOTOBOOTH_RETENTION_DAYS`.

---

## Giới hạn cần biết trước

> **Khách phải tải ảnh về máy trước khi rời quán.**

Hệ thống chạy hoàn toàn trong WiFi quán. Ra khỏi WiFi là QR không mở được nữa.

Đây là hệ quả của việc không dùng cloud — đổi lại bạn không tốn phí hằng
tháng, ảnh không rời khỏi máy của quán. Cả hai màn hình khách đều có dòng
nhắc *"Hãy tải ảnh về máy trước khi rời quán"*.

Nếu khách quên, nhân viên vẫn lấy hộ được trong 7 ngày: trang nhân viên →
tìm phiên → **Xem ảnh** → tải về.

---

## Cấu hình chi tiết

Mở `.env.local` để chỉnh. Sửa xong phải khởi động lại server.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PHOTOBOOTH_DATA` | `./photobooth-data` | Thư mục lưu ảnh + database |
| `PHOTOBOOTH_PASSWORD` | `photobooth` | Mật khẩu nhân viên — **phải đổi** |
| `PHOTOBOOTH_PORT` | `8080` | Cổng chạy |
| `PHOTOBOOTH_ROOMS` | `1,2,3` | Danh sách phòng |
| `PHOTOBOOTH_RETENTION_DAYS` | `7` | Số ngày giữ ảnh |
| `PHOTOBOOTH_CODE_TTL` | `120` | Mã 4 số hết hạn sau bao nhiêu phút |
| `PHOTOBOOTH_CAPTURE` | *(trống)* | Thư mục máy ảnh lưu ảnh vào |

Muốn hiểu sâu hơn về cách hệ thống hoạt động, đọc [README.md](README.md).
