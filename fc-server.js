/**
 * fc-server.js —— 阿里云函数计算 FC（Web 函数 / 自定义运行时）入口
 *
 * 复用 edge-functions/_lib.js 的核心代理逻辑：把 Node HTTP 请求包装成标准
 * Web Request，调用处理器后把 Web Response 写回 Node 响应。逻辑零改动。
 *
 * FC 环境变量说明：
 *  - FC 会注入 PORT（默认 9000），必须监听 0.0.0.0
 *  - 可选环境变量 PROXY_TOKEN：设置后代理请求必须携带 &key=<token> 防滥用
 */
import http from 'node:http';
import { Readable } from 'node:stream';
import handler from './edge-functions/_lib.js';

const PORT = Number(process.env.FC_SERVER_PORT || process.env.PORT || 9000);

function readBody(req) {
  if (['GET', 'HEAD'].includes(req.method)) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const body = await readBody(req);
    const init = { method: req.method, headers: new Headers(req.headers) };
    if (body !== undefined) {
      init.body = body;
      init.duplex = 'half';
    }
    const host = req.headers.host || 'localhost';
    const request = new Request(`http://${host}${req.url}`, init);
    const response = await handler({ request, params: {}, env: process.env });

    // 复制响应头（We use strip set-cookie already in _lib）
    const headers = {};
    response.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(response.status, headers);
    if (response.body) {
      Readable.fromWeb(response.body).pipe(res);
    } else {
      res.end();
    }
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    res.end(JSON.stringify({ error: 'internal', message: e.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`api-proxy listening on 0.0.0.0:${PORT}`);
});
