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

**Trình cài đặt tự làm:** tạo thư mục, ghi cấu hình, mở firewall, đăng ký
tự chạy khi bật máy, tạo lối tắt ngoài màn hình.

**Hai việc người dùng vẫn phải tự làm** (hộp thoại cuối có nhắc):
- Đặt IP tĩnh cho máy chủ
- Tắt chế độ ngủ

---

## Gói có gì

| Thứ | Vì sao cần |
|---|---|
| `runtime\node.exe` | Node nhúng sẵn — máy đích không cần cài |
| `server\`, `src\` | Mã nguồn chạy trực tiếp bằng `--experimental-strip-types` |
| `dist\` | Giao diện đã build |
| `node_modules\` | Chỉ thư viện lúc chạy (`sharp`, `qrcode`) |
| `CAI-DAT.bat` | Người dùng nhấp đúp cái này |
| `Chay-server.cmd` | Chạy tay khi cần |
| `Mo-trang-quan-ly.cmd` | Lối tắt mở trang nhân viên |

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
