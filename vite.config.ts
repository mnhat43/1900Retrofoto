import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

/**
 * 4 entry point riêng thay vì một router chung.
 *
 * Mỗi vai trò tải đúng phần mình cần — điện thoại khách không phải tải kèm
 * dashboard nhân viên. Code dùng chung (core/, render/) được Rollup tách
 * thành chunk riêng nên không bị lặp lại.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        room: resolve(import.meta.dirname, 'room.html'),      // màn hình phòng
        staff: resolve(import.meta.dirname, 'staff.html'),    // nhân viên
        studio: resolve(import.meta.dirname, 'studio.html'),  // khách
      },
    },
  },
  server: {
    // Dev: chuyển tiếp API và ảnh sang server Node đang chạy
    proxy: {
      '/api': 'http://localhost:8080',
      '/media': 'http://localhost:8080',
    },
  },
})
