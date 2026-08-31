@echo off
REM Chep file nay thanh start-server.cmd roi sua cho dung may cua ban.
REM start-server.cmd KHONG duoc commit vi chua mat khau that.

cd /d "E:\photobook"

REM Thu muc chua database va anh khach
set PHOTOBOOTH_DATA=D:\photobooth

REM Thu muc phan mem Canon luu anh vao
set PHOTOBOOTH_CAPTURE=D:\Anh

REM DOI mat khau nay truoc khi dung that
set PHOTOBOOTH_PASSWORD=doi-mat-khau-nay

set PHOTOBOOTH_PORT=8090

node --experimental-strip-types --disable-warning=ExperimentalWarning server\index.ts
