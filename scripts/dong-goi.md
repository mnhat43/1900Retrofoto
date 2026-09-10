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

Bốn file `.bat` cuối **tự xin quyền Administrator** (`Start-Process -Verb
RunAs`) thay vì bắt nhân viên nhớ chuột phải.

`react` và `react-dom` bị loại — chỉ dùng lúc build, không cần khi chạy.

---

## Cập nhật bản mới

Đóng gói lại rồi đưa file `.exe` mới. Cài đè lên bản cũ.

**Dữ liệu khách an toàn:** ảnh và database nằm ở thư mục riêng
(`D:\photobooth`), không nằm trong thư mục cài đặt. Gỡ cài đặt cũng không
đụng vào.

---

## Vì sao không dùng `pkg` hay `nexe`

Hai công cụ đó gộp Node + mã nguồn thành **một** file `.exe` duy nhất, nghe
gọn hơn. Nhưng dự án này dùng:

- **`sharp`** — có file nhị phân native, `pkg` hay hỏng ở khâu này
- **`node:sqlite`** — mô-đun có sẵn trong Node 22, `pkg` chưa hỗ trợ
- **`--experimental-strip-types`** — chạy thẳng TypeScript, cần Node thật

Chép nguyên `node.exe` vào gói tuy nặng hơn nhưng **chắc chắn chạy**, và
dễ sửa khi có sự cố.
