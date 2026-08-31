/**
 * Dev server Vite phục vụ một trang TRẮNG ở `/`.
 *
 * Các script kiểm chứng phần render chỉ cần một tài liệu để `import()` module
 * qua dev server — chúng không cần UI nào cả. Nếu trỏ vào một entry thật
 * (staff.html chẳng hạn) thì app sẽ gọi API, gặp 404 vì không có server Node,
 * rồi ghi lỗi ra console — làm hỏng kết quả kiểm chứng dù phần render vẫn đúng.
 *
 * Trang trắng giữ cho phép kiểm chỉ nói về đúng thứ nó muốn nói.
 */
import { createServer } from 'vite';

export async function blankHost(port) {
  const server = await createServer({
    server: { port },
    plugins: [
      {
        name: 'blank-host',
        configureServer(s) {
          s.middlewares.use((req, res, next) => {
            const path = (req.url ?? '').split('?')[0];
            if (path !== '/' && path !== '/index.html') return next();
            res.setHeader('content-type', 'text/html');
            res.end('<!doctype html><meta charset="utf-8"><title>verify</title>');
          });
        },
      },
    ],
  });
  await server.listen();
  return server;
}
