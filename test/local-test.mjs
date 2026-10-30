/**
 * 本地验证脚本：用 Node（18+ 自带 fetch/Request/Response）模拟边缘函数运行时，
 * 实测核心代理逻辑的真实行为。运行：node test/local-test.mjs
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const libPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'edge-functions', '_lib.js');
const { default: onRequest, renderHomepage } = await import(new URL('file:///' + libPath.replace(/\\/g, '/')).href);

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${detail}`); }
}

async function call(url, init = {}, env = {}) {
  const request = new Request(url, init);
  return onRequest({ request, params: {}, env });
}

console.log('== 1. 首页渲染 ==');
{
  const res = await call('https://demo.edgeone.app/');
  const html = await res.text();
  check('返回 HTML 200', res.status === 200 && res.headers.get('content-type').includes('text/html'));
  check('包含用法示例与在线测试入口', html.includes('/?url=') && html.includes('在线测试'));
}

console.log('== 2. 代理转发真实源站（苹果CMS采集接口）==');
{
  const target = 'https://bfzyapi.com/api.php/provide/vod/?ac=list&pg=1';
  const res = await call('https://demo.edgeone.app/?url=' + encodeURIComponent(target));
  const text = await res.text();
  check('HTTP 200', res.status === 200, 'status=' + res.status);
  check('返回 JSON 结构', text.includes('"code":1') && text.includes('"list"'));
  check('附加 CORS 头', res.headers.get('access-control-allow-origin') === '*');
  check('Content-Type 为 JSON', (res.headers.get('content-type') || '').includes('json'));
  check('不泄露源站 Set-Cookie', !res.headers.has('set-cookie'));
}

console.log('== 3. 代理转发 latest.json ==');
{
  const res = await call('https://demo.edgeone.app/?url=' + encodeURIComponent('https://mylazily.github.io/ziyuanzhan/data/latest.json'));
  const data = await res.json();
  check('HTTP 200', res.status === 200);
  check('解析出资源列表', Array.isArray(data.resources) && data.resources.length > 0);
}

console.log('== 4. 错误处理 ==');
{
  const r1 = await call('https://demo.edgeone.app/?url=' + encodeURIComponent('ftp://x.com/a'));
  check('拒绝非 http/https 协议 (400)', r1.status === 400, 'status=' + r1.status);

  const r2 = await call('https://demo.edgeone.app/?url=' + encodeURIComponent('https://no-such-host-zzz12345.invalid/'));
  check('不可达源站返回 502', r2.status === 502, 'status=' + r2.status);

  const r3 = await call('https://demo.edgeone.app/', {}, { PROXY_TOKEN: 'abc' });
  check('启用 Token 后无 key 首页仍可访问', r3.status === 200);

  const r4 = await call('https://demo.edgeone.app/?url=https%3A%2F%2Fbfzyapi.com%2F', {}, { PROXY_TOKEN: 'abc' });
  check('启用 Token 后无 key 代理被拒 (401)', r4.status === 401, 'status=' + r4.status);

  const r5 = await call('https://demo.edgeone.app/?url=https%3A%2F%2Fbfzyapi.com%2F&key=abc', {}, { PROXY_TOKEN: 'abc' });
  check('正确 key 放行 (200)', r5.status === 200, 'status=' + r5.status);
}

console.log('== 5. OPTIONS 预检 ==');
{
  const res = await call('https://demo.edgeone.app/?url=https%3A%2F%2Fbfzyapi.com%2F', { method: 'OPTIONS' });
  check('204 且带 CORS 头', res.status === 204 && res.headers.get('access-control-allow-methods').includes('GET'));
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
