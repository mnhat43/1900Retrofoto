# Hướng dẫn cài đặt 1900 Retrofoto

**Dành cho người không biết lập trình.** Bạn chỉ cần biết dùng Windows cơ bản:
mở thư mục, nhấp chuột, gõ chữ.

Làm đúng thứ tự, khoảng **20 phút** là xong.

---

## Phần A — Chuẩn bị

### Bạn cần có

| Thứ | Ghi chú |
|---|---|
| 1 máy tính Windows | Đặt ở quầy. Máy này gọi là **máy chủ**, phải bật cả ngày |
| Kết nối internet | Chỉ cần lúc tải phần mềm. Cài xong thì không cần nữa |
| WiFi của quán | Máy chủ, máy trong phòng chụp, điện thoại khách phải **cùng WiFi** |

### Kiểm tra ổ đĩa còn trống

Ảnh khách rất nặng. Trước khi cài, xem ổ nào còn nhiều chỗ:

1. Mở **This PC** (hoặc My Computer)
2. Nhìn các ổ `C:`, `D:`, `E:`… — mỗi ổ ghi rõ còn bao nhiêu GB
3. **Ghi lại tên ổ còn nhiều nhất**, cần ít nhất **50 GB**

> Ví dụ: nếu ổ `E:` còn 130 GB thì lát nữa bạn điền `E:\photobooth`
> thay vì để mặc định `D:\photobooth`.

**Không cần cài Node.js hay bất cứ phần mềm nào khác.** Mọi thứ đã nằm sẵn
trong file tải về.

---

## Phần B — Tải phần mềm

1. Mở trình duyệt, vào địa chỉ:

   **https://github.com/mnhat43/1900Retrofoto/releases**

2. Tìm mục **Assets** ở phần dưới cùng của bản mới nhất
3. Bấm vào file **`1900Retrofoto.zip`** (khoảng 44 MB) để tải về

> Trình duyệt có thể cảnh báo *"…is not commonly downloaded"* → bấm mũi tên
> nhỏ bên cạnh → chọn **Keep**. File này an toàn, chỉ là Windows chưa quen.

4. Vào thư mục **Downloads**, **chuột phải** vào file vừa tải →
   **Extract All…** → bấm **Extract**
5. Chép thư mục `1900Retrofoto` vừa giải nén vào ổ đĩa, ví dụ thành
   `C:\1900Retrofoto`

> Đừng để trong Downloads hay Desktop — dễ bị xoá nhầm.

---

## Phần C — Cài đặt

### Bước 1: Chạy trình cài đặt

Mở thư mục `C:\1900Retrofoto`, tìm file **`CAI-DAT.bat`**.

> ⚠️ **Chuột phải** vào file đó → chọn **"Run as administrator"**
>
> **Không** nhấp đúp. Nhấp đúp sẽ hiện bảng báo lỗi và không cài được.

Windows có thể hỏi *"Do you want to allow this app to make changes?"* → bấm **Yes**.

### Bước 2: Điền thông tin

Một cửa sổ hồng hiện ra với 4 ô:

```
┌──────────────────────────────────────────┐
│  1900 RETROFOTO                          │
│  Dien thong tin ben duoi roi bam Cai dat │
│                                          │
│  Mat khau nhan vien  [____________]      │
│  Thu muc luu anh     [D:\photobooth]     │
│  Thu muc may anh     [D:\Anh]            │
│  Cong                [8090]              │
│                                          │
│            [   Cai dat   ]               │
└──────────────────────────────────────────┘
```

Điền như sau:

| Ô | Điền gì |
|---|---|
| **Mật khẩu nhân viên** | Tự đặt, **ít nhất 4 ký tự**. Nhân viên dùng để đăng nhập. Ghi lại chỗ nào đó |
| **Thư mục lưu ảnh** | Sửa chữ `D` thành ổ bạn đã chọn ở Phần A. Ví dụ `E:\photobooth` |
| **Thư mục máy ảnh** | Sửa giống ổ trên. Ví dụ `E:\Anh` |
| **Cổng** | Để nguyên `8090` |

### Bước 3: Bấm "Cai dat"

Chờ vài giây. Xong sẽ hiện bảng thông báo có **4 địa chỉ**:

```
Trang quan ly:  http://192.168.1.50:8090/staff
Phong 1:        http://192.168.1.50:8090/room?p=1
Phong 2:        http://192.168.1.50:8090/room?p=2
Phong 3:        http://192.168.1.50:8090/room?p=3
```

📸 **Chụp màn hình bảng này lại** — lát nữa cần dùng.

Số `192.168.1.50` là địa chỉ máy chủ của bạn, mỗi máy một khác.

Sau khi bấm OK, phần mềm **chạy luôn** và tự chạy mỗi lần bật máy.

Trình cài đặt cũng đã **tự làm giùm** những việc sau, bạn không phải mở
Windows Settings lần nào:

| Việc | Vì sao cần |
|---|---|
| Tắt chế độ ngủ | Máy ngủ là khách không quét được QR. Điện thoại khách **không đánh thức máy được** |
| Tắt ngủ cả khi chạy pin | Laptop mất điện thì chuyển sang pin và tự ngủ; điện có lại máy **vẫn đang ngủ** |
| Tắt "đóng nắp là ngủ" | Chỉ áp dụng nếu máy chủ là laptop |
| Mở firewall cho cả 2 loại mạng | Windows hay xếp WiFi quán là *Public*; chỉ mở *Private* là điện thoại khách bị chặn sạch |
| Đăng ký tự chạy khi bật máy | Mất điện, bật lại là server tự lên, không cần ai đăng nhập |
| Đăng ký tự cứu khi server chết | Cứ 5 phút kiểm tra một lần, chết thì tự bật lại |
| Tạo 5 lối tắt ngoài màn hình | `1900 Retrofoto`, `KIEM-TRA`, `KHOI-DONG-LAI`, `SUA-IP`, `DAT-IP-TINH` |

---

## Phần D — Một việc nên làm

### Ghim địa chỉ cố định

**Vì sao:** Mã QR đưa cho khách có chứa địa chỉ máy chủ. Mặc định cục WiFi
*cho thuê* địa chỉ này theo kiểu tạm thời — mất điện hoặc khởi động lại cục
WiFi là máy có thể được cấp số khác, và **tất cả QR đã đưa khách sẽ hỏng
hết**.

**Cách làm — một nút:**

**Nhấp đúp** lối tắt **`DAT-IP-TINH`** ngoài màn hình.

Windows hỏi *"Do you want to allow…"* → bấm **Yes**. Rồi gõ chữ `g` → Enter.

Xong. Không phải điền số nào cả.

> **Vì sao không bắt bạn tự điền trong Settings:** bảng 4 ô trong Windows rất
> dễ điền sai. Gateway thường là `.1` nhưng **không phải luôn luôn** — có
> router dùng `.254`, có mạng là `10.x`. Điền sai gateway là máy mất mạng
> hoàn toàn.
>
> File này **đọc lại đúng bộ số máy đang chạy tốt** rồi ghim y nguyên bộ số
> đó. Không đoán, không gõ tay, nên không sai. Và nếu ghim xong mà mất mạng,
> nó **tự trả lại như cũ** ngay lập tức.

**Nên làm thêm (nhờ kỹ thuật hoặc chủ quán):** vào trang quản lý cục WiFi,
đặt *DHCP reservation* cho địa chỉ đó. Như vậy cục WiFi không bao giờ cấp số
đó cho máy khác.

---

## Phần E — Cài máy trong phòng chụp

Làm cho **từng phòng**. Ví dụ dưới đây là phòng 1.

1. Ra màn hình desktop, **chuột phải** vào chỗ trống → **New** → **Shortcut**
2. Dán dòng này vào ô, **sửa `192.168.1.50` thành địa chỉ máy chủ của bạn**:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --incognito http://192.168.1.50:8090/room?p=1
```

3. Bấm **Next** → đặt tên `Phong 1` → **Finish**
4. **Phòng 2:** làm lại, đổi `p=1` thành `p=2`
5. **Phòng 3:** đổi thành `p=3`

### Cho tự mở khi bật máy

1. Nhấn phím **Windows + R** cùng lúc
2. Gõ `shell:startup` → Enter
3. Kéo lối tắt vừa tạo vào thư mục vừa mở

> **Thoát màn hình toàn màn hình:** nhấn `Alt + F4`.

---

## Phần F — Nối phần mềm máy ảnh

Hệ thống lấy ảnh bằng cách **đọc thư mục**, không cần cắm dây gì thêm.

**Cách hoạt động:**

1. Bạn tạo mã cho khách, ví dụ mã `8206`
2. Hệ thống tự tạo thư mục `E:\Anh\8206\`
3. Bạn chỉnh phần mềm máy ảnh (EOS Utility, digiCamControl…) lưu ảnh vào đó
4. Khách bấm **"Đã chụp xong"** → hệ thống tự nạp ảnh

> Nếu chưa quen, cứ chép ảnh vào thư mục đó bằng tay cũng chạy được.

---

## Phần G — Chạy thử trước khi mở cửa

Tự đóng vai khách một lần cho chắc:

1. Mở lối tắt **1900 Retrofoto** ngoài màn hình → đăng nhập bằng mật khẩu vừa đặt
2. Chọn **Phòng 1** → chọn số kiểu ảnh → bấm **Tạo mã**
3. Ghi lại 4 số hiện ra
4. Sang máy phòng 1, nhập 4 số đó
5. Chép vài tấm ảnh bất kỳ vào thư mục `E:\Anh\<4 số>\`
6. Bấm **"Đã chụp xong"** → hiện 2 mã QR
7. Lấy điện thoại (**phải nối WiFi quán**, không dùng 4G) quét QR bên phải
8. Chọn khung → chọn ảnh → bấm **Hoàn thiện & Lưu**
9. Bấm **Tải xuống**

Ảnh về được máy điện thoại là hệ thống sẵn sàng.

---

## Dùng hằng ngày

### Tạo mã cho khách

Mở lối tắt **1900 Retrofoto** → chọn phòng → chọn số kiểu ảnh → **Tạo mã**
→ đọc 4 số cho khách.

### Khi nào phòng trống

Ngay khi khách bấm **"Đã chụp xong"**. Khách cũ cầm điện thoại ra ngoài
ngồi ghép ảnh, khách mới vào chụp được luôn — không phải chờ.

### Đóng phiên

Sau khi khách đã tải ảnh về, bấm **Đóng** ở dòng *"đang ghép ảnh"*.

> Đóng sớm quá thì khách **mất quyền quét QR**. Chờ khách tải xong rồi hãy đóng.

### Ảnh tự xoá sau 7 ngày

Khách quên tải thì trong 7 ngày vẫn lấy hộ được: trang quản lý → tìm phiên
→ **Xem ảnh** → tải về.

### Theo dõi ổ đĩa

Trên thanh tiêu đề trang quản lý, góc phải, luôn có một **đèn báo dung
lượng** — ví dụ `130 GB trống`.

| Màu đèn | Nghĩa là | Phải làm gì |
|---|---|---|
| Xám | Còn thoải mái | Không cần làm gì |
| Vàng | Còn dưới 20 GB | Dọn ảnh cũ trong tuần này |
| Đỏ | Còn dưới 5 GB | **Dọn ngay**, không thì ảnh khách không lưu được |

**Cách dọn:** bấm vào đèn đó (hoặc tab **Ổ đĩa**) → hiện các mốc:

```
Cũ hơn 30 ngày     12 phiên · 8.4 GB
Cũ hơn 14 ngày     34 phiên · 22.1 GB
Cũ hơn 7 ngày      51 phiên · 35.8 GB
Cũ hơn 3 ngày      68 phiên · 47.2 GB
```

Bấm mốc **từ trên xuống**, dừng lại khi đã đủ chỗ. Mỗi nút ghi rõ sẽ xoá bao
nhiêu phiên và được thêm bao nhiêu GB **trước khi** bạn bấm.

> **An toàn:** phiên đang có khách trong phòng **không bao giờ** bị xoá, kể cả
> khi đã quá mốc. Danh sách phiên vẫn giữ lại để tra cứu, chỉ ảnh bị xoá.

---

## ⚙️ Khi có sự cố — chỉ cần 3 nút

Ba lối tắt này nằm ngoài màn hình máy chủ. Nhân viên **không cần biết gì
thêm** ngoài ba dòng dưới đây.

### 1. Trang không lên, hoặc khách không quét được QR

**Nhấp đúp `KIEM-TRA`** (ngoài màn hình).

Nó tự kiểm tra hết mọi thứ rồi in ra **đúng việc cần làm**, ví dụ:

```
  KET QUA
  -----------------------------------------------
  [OK      ] Server dang chay (da chay 6 gio 12 phut)
  [LOI     ] MA QR TRO SAI DIA CHI: QR ghi 192.168.1.77
             nhung may dang la 192.168.1.50
  [OK      ] O dia con 130 GB trong

  VIEC CAN LAM (lam theo thu tu tu tren xuong):
  -----------------------------------------------
  1. Nhap dup SUA-IP.bat - no tu sua lai het, mat 10 giay
```

Làm theo danh sách đó là xong. Không phải đoán, không phải đọc log.

### 2. Server chết hoặc treo

**Nhấp đúp `KHOI-DONG-LAI`**, chờ khoảng 20 giây.

Xong sẽ hiện `XONG. Server dang chay.` kèm 4 địa chỉ.

> Thường thì **không cần làm gì cả** — hệ thống tự kiểm tra 5 phút một lần và
> tự bật lại. Nút này để không phải chờ 5 phút đó.

### 3. Địa chỉ bị đổi (sau mất điện, đổi cục WiFi)

**Nhấp đúp `SUA-IP`** ngoài màn hình.

Nó tự tìm địa chỉ mới, ghi lại vào cấu hình, tạo lại lối tắt, khởi động lại
server, và ghi danh sách địa chỉ mới ra file `DIA-CHI-1900RETROFOTO.txt`
ngoài màn hình.

> ⚠️ **Còn một việc phải làm bằng tay:** lối tắt trên **từng máy trong phòng
> chụp** vẫn ghi địa chỉ cũ. Ra từng phòng, chuột phải vào lối tắt →
> **Properties** → sửa địa chỉ theo file `DIA-CHI-1900RETROFOTO.txt`.
>
> Làm `DAT-IP-TINH.bat` (Phần D) một lần là gần như không bao giờ phải làm
> lại việc này.

---

## ⚠️ Điều khách cần biết

> **Khách phải tải ảnh về máy TRƯỚC KHI rời quán.**

Hệ thống chạy trong WiFi quán. Ra khỏi quán là QR không mở được nữa.

Màn hình đã có dòng nhắc sẵn, nhưng nhân viên nên nói thêm một câu cho chắc.

---

## Cập nhật bản mới

Khi có bản mới:

1. Vào lại **https://github.com/mnhat43/1900Retrofoto/releases**
2. Tải file `1900Retrofoto.zip` mới nhất
3. Giải nén, chép đè lên thư mục `C:\1900Retrofoto` cũ
4. Chạy lại `CAI-DAT.bat` (chuột phải → Run as administrator)

> **Ảnh khách an toàn.** Ảnh nằm ở thư mục riêng (`E:\photobooth`),
> không nằm chung với phần mềm.

---

## Gặp trục trặc

### "Can chay bang quyen Administrator"

Bạn đã nhấp đúp thay vì chuột phải. Quay lại Phần C Bước 1, chuột phải vào
`CAI-DAT.bat` → **Run as administrator**.

### Điện thoại khách không quét được QR

**Việc đầu tiên: nhấp đúp `KIEM-TRA` ngoài màn hình.** Nó tự tìm ra nguyên
nhân trong ba nguyên nhân dưới đây và chỉ đúng việc cần làm.

Nếu muốn tự kiểm tra bằng tay:

1. **Điện thoại có nối WiFi quán không?** Dùng 4G là chắc chắn không vào được
2. **Máy chủ có bật không?** Nhấp đúp `KHOI-DONG-LAI` cho chắc
3. **Địa chỉ có đổi không?** Nhấp đúp `SUA-IP.bat` — xem mục *Khi có sự cố*

### Trang trắng, không hiện gì

Nhấn `Ctrl + Shift + R` trong trình duyệt. Vẫn trắng thì mở tab ẩn danh
(`Ctrl + Shift + N`) thử lại.

### Máy chủ tắt, muốn bật lại

Nhấp đúp lối tắt **`KHOI-DONG-LAI`** ngoài màn hình. Chờ khoảng 20 giây.

> Bình thường **không cần làm gì** — hệ thống tự bật lại trong vòng 5 phút.

Muốn xem cửa sổ chạy để đọc lỗi thì nhấp đúp `Chay-server.cmd` trong thư mục
`C:\1900Retrofoto`. Cửa sổ đen hiện ra thì **để nguyên đó**, tắt là dừng.

### Bấm "Đã chụp xong" mà không thấy ảnh

Ảnh chưa nằm đúng chỗ. Mở File Explorer, vào `E:\Anh\` — phải có thư mục
tên **đúng bằng 4 số** của mã, và ảnh nằm ngay trong đó.

### Quên mật khẩu nhân viên

Mở thư mục `C:\1900Retrofoto`, tìm file `.env.local`, mở bằng **Notepad**.
Dòng `PHOTOBOOTH_PASSWORD=` chính là mật khẩu. Sửa được luôn — sửa xong
khởi động lại máy.

### Báo lỗi cổng đã bị dùng

Máy đã có phần mềm khác chiếm cổng đó. Chạy lại `CAI-DAT.bat`, đổi ô
**Cổng** thành `8095`.

> Nhớ **tạo lại lối tắt** ở các máy phòng với số cổng mới.

### Đèn ổ đĩa màu đỏ

Ổ gần hết chỗ. Bấm vào đèn đó → tab **Ổ đĩa** → bấm mốc dọn dẹp từ trên
xuống. Xem mục *Theo dõi ổ đĩa* ở trên.

### Không biết đang bị gì

Nhấp đúp **`KIEM-TRA`** ngoài màn hình. Nó chỉ ra đúng việc cần làm.

---

## Việc nên làm hằng tuần

**1. Sao lưu ảnh.** Ổ cứng hỏng là mất sạch, không có bản dự phòng nào khác.

Cách đơn giản nhất: cắm ổ cứng ngoài, chép thư mục `E:\photobooth` sang đó
mỗi tuần một lần.

**2. Nhấp đúp `KIEM-TRA` một lần.** Mất 15 giây, và nó phát hiện được những
thứ đang âm thầm sai mà chưa ai thấy — ví dụ địa chỉ đã đổi nhưng chưa ai
quét QR để phát hiện, hoặc ổ đĩa sắp hết chỗ.

---

## Chuyển sang máy chủ khác

1. Trên máy cũ: mở Task Manager → tắt hết tiến trình `node.exe` để dừng server
2. Chép **cả thư mục** `E:\photobooth` sang máy mới
3. Cài đặt trên máy mới theo hướng dẫn này, điền **đúng đường dẫn cũ**
4. Chạy `SUA-IP.bat` rồi `DAT-IP-TINH.bat` trên máy mới
5. Sửa lối tắt ở các máy trong phòng chụp theo địa chỉ mới

Thư mục đó chứa toàn bộ ảnh khách, khung ảnh, và bộ chỉnh màu đã lưu.

---

## Dành cho người biết lập trình

Muốn sửa code hoặc tự đóng gói:

```bash
git clone https://github.com/mnhat43/1900Retrofoto.git
cd 1900Retrofoto
npm install
npm run build

# Đóng gói thành thư mục cài đặt sẵn
powershell -ExecutionPolicy Bypass -File scripts\package-app.ps1
```

Chi tiết ở [README.md](README.md) và
[scripts/dong-goi.md](scripts/dong-goi.md).
