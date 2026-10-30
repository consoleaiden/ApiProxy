/**
 * _lib.js —— API 代理转发核心逻辑（供各路由文件复用）
 *
 * 部署在腾讯 EdgeOne Pages 边缘函数运行时（基于 V8 + 标准 Web API）。
 * 用法：GET https://<你的域名>/?url=<经过 URL 编码的源站地址>
 * 示例：GET https://xxx.edgeone.app/?url=https%3A%2F%2Fbfzyapi.com%2Fapi.php%2Fprovide%2Fvod%2F%3Fac%3Dlist
 *
 * 安全配置（按需修改后重新部署）：
 *  - PROXY_TOKEN：设为非空字符串后，所有代理请求必须携带 ?key=<token>，防止代理被陌生人滥用
 *  - ALLOWED_HOSTS：设为数组后仅允许转发白名单内的源站；null 表示不限制
 */

// ==================== 配置区 ====================
const PROXY_TOKEN = null; // 示例：'my-secret-token'；保持 null 表示不启用鉴权
const ALLOWED_HOSTS = null; // 示例：['bfzyapi.com', '360zy.com']；保持 null 表示允许任意源站
const UPSTREAM_TIMEOUT_MS = 15000; // 回源超时时间（毫秒）

// 逐跳头：不应在代理之间透传
const HOP_BY_HOP_HEADERS = new Set([
  'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length', 'accept-encoding',
  'cookie', 'set-cookie', // 隐私考虑：不透传 Cookie
]);

/** 校验并解析目标 URL，非法时抛错 */
export function validateTarget(raw) {
  if (!raw) throw new Error('缺少 url 参数，用法：/?url=https://源站地址');
  let target;
  try {
    target = new URL(raw);
  } catch {
    throw new Error('url 参数不是合法的 URL');
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('仅支持 http/https 协议的源站地址');
  }
  if (Array.isArray(ALLOWED_HOSTS) && !ALLOWED_HOSTS.includes(target.hostname)) {
    throw new Error(`源站 ${target.hostname} 不在白名单内`);
  }
  return target;
}

/** 主入口：处理一次代理请求 */
export default async function onRequest(context) {
  const { request, env } = context;
  const reqUrl = new URL(request.url);
  const targetRaw = reqUrl.searchParams.get('url');

  // 无 url 参数时渲染使用说明首页
  if (!targetRaw) {
    return renderHomepage(reqUrl.origin);
  }

  // 跨域预检请求直接放行
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders({}) });
  }

  // 可选 Token 鉴权：配置 PROXY_TOKEN 环境变量后强制校验
  const token = env && env.PROXY_TOKEN ? env.PROXY_TOKEN : PROXY_TOKEN;
  if (token && reqUrl.searchParams.get('key') !== token) {
    return jsonResponse({ error: 'unauthorized', message: '缺少或错误的 key 参数' }, 401);
  }

  // 校验目标地址
  let target;
  try {
    target = validateTarget(targetRaw);
  } catch (e) {
    return jsonResponse({ error: 'bad_request', message: e.message }, 400);
  }

  // 构造回源请求：透传安全头，附加体（POST 等场景）
  const headers = new Headers();
  for (const [k, v] of request.headers.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(k.toLowerCase())) headers.set(k, v);
  }
  if (!headers.has('user-agent')) headers.set('user-agent', 'api-proxy/1.0 (+edgeone-pages)');

  const init = { method: request.method, headers, redirect: 'follow' };
  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = await request.arrayBuffer();
  }

  // 回源（带超时控制）
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(target.toString(), { ...init, signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    const msg = e.name === 'AbortError' ? `回源超时（>${UPSTREAM_TIMEOUT_MS}ms）` : `回源失败：${e.message}`;
    return jsonResponse({ error: 'upstream_error', message: msg, url: target.toString() }, 502);
  }
  clearTimeout(timer);

  // 组装响应：透传内容与安全头，附加 CORS 头使浏览器端可直接调用
  const resHeaders = new Headers();
  upstream.headers.forEach((v, k) => {
    if (!HOP_BY_HOP_HEADERS.has(k.toLowerCase())) resHeaders.set(k, v);
  });
  Object.entries(corsHeaders(resHeaders)).forEach(([k, v]) => resHeaders.set(k, v));

  return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
}

/** 生成 CORS 响应头（返回普通对象便于合并） */
function corsHeaders(base) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

/** JSON 响应 */
function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });
}

/** 使用说明首页（内联单文件，避免静态资源抢占 / 路由） */
export function renderHomepage(origin) {
  const example = `${origin}/?url=${encodeURIComponent('https://bfzyapi.com/api.php/provide/vod/?ac=list')}`;
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>API 代理加速</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
         background: #f5f7fa; color: #1f2937; line-height: 1.6; padding: 24px 16px 60px; }
  .wrap { max-width: 860px; margin: 0 auto; }
  h1 { font-size: 26px; margin-bottom: 8px; }
  .sub { color: #6b7280; margin-bottom: 24px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
  .card h2 { font-size: 17px; margin-bottom: 12px; }
  code, pre { font-family: ui-monospace, Consolas, monospace; font-size: 13px; }
  .snippet { background: #f3f4f6; border-radius: 8px; padding: 12px 14px; overflow-x: auto;
             word-break: break-all; cursor: pointer; }
  .snippet:hover { background: #eef2ff; }
  .hint { color: #9ca3af; font-size: 12px; margin-top: 6px; }
  input[type=text] { width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; }
  button { background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 10px 22px;
           font-size: 14px; cursor: pointer; margin-top: 10px; }
  button:hover { background: #1d4ed8; }
  button:disabled { background: #93c5fd; cursor: wait; }
  pre.out { background: #0f172a; color: #e2e8f0; padding: 14px; border-radius: 8px;
            max-height: 320px; overflow: auto; margin-top: 12px; white-space: pre-wrap; word-break: break-all; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
  th { color: #6b7280; font-weight: 500; font-size: 13px; }
  .ok { color: #16a34a; } .bad { color: #dc2626; }
  .act { color: #2563eb; cursor: pointer; margin-right: 10px; }
  .status { margin-top: 10px; font-size: 13px; color: #6b7280; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🚀 API 代理加速</h1>
  <p class="sub">部署于腾讯 EdgeOne Pages 边缘函数 · 服务端转发 · 免 CORS · 全国边缘节点加速</p>

  <div class="card">
    <h2>用法</h2>
    <div class="snippet" id="snippet" title="点击复制">GET ${escapeHtml(example)}</div>
    <p class="hint">把 <code>?url=</code> 后面换成任意源站 API 地址（需 URL 编码），返回体即源站内容，且已附加跨域头，浏览器可直接调用。点击上方文本可复制。</p>
  </div>

  <div class="card">
    <h2>在线测试</h2>
    <input type="text" id="target" placeholder="输入源站 API 地址，如 https://bfzyapi.com/api.php/provide/vod/?ac=list" />
    <button id="go" onclick="runTest()">发起代理请求</button>
    <pre class="out" id="out" hidden></pre>
    <div class="status" id="stat"></div>
  </div>

  <div class="card">
    <h2>可用源站列表（来自资源站监测 latest.json）</h2>
    <table>
      <thead><tr><th>名称</th><th>状态</th><th>资源数</th><th>响应</th><th>操作</th></tr></thead>
      <tbody id="list"><tr><td colspan="5">加载中…</td></tr></tbody>
    </table>
    <div class="status" id="listStat"></div>
  </div>
</div>
<script>
  var ORIGIN = location.origin;
  var LATEST = 'https://mylazily.github.io/ziyuanzhan/data/latest.json';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  document.getElementById('snippet').onclick = function () {
    navigator.clipboard.writeText(this.textContent.replace(/^GET /, ''));
    this.title = '已复制 ✓';
  };

  function runTest() {
    var target = document.getElementById('target').value.trim();
    var out = document.getElementById('out'), stat = document.getElementById('stat'), btn = document.getElementById('go');
    if (!target) { stat.textContent = '请先输入源站地址'; return; }
    btn.disabled = true; out.hidden = false; out.textContent = '请求中…';
    var t0 = performance.now();
    fetch(ORIGIN + '/?url=' + encodeURIComponent(target))
      .then(function (r) {
        stat.textContent = 'HTTP ' + r.status + ' · 耗时 ' + Math.round(performance.now() - t0) + ' ms';
        return r.text();
      })
      .then(function (t) {
        try { out.textContent = JSON.stringify(JSON.parse(t), null, 2); }
        catch (e) { out.textContent = t; }
      })
      .catch(function (e) { out.textContent = '请求失败：' + e.message; })
      .finally(function () { btn.disabled = false; });
  }

  fetch(ORIGIN + '/?url=' + encodeURIComponent(LATEST))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var rows = (data.resources || []).map(function (x) {
        var ok = x.health && x.health.is_alive;
        return '<tr><td>' + esc(x.name) + '</td>'
          + '<td class="' + (ok ? 'ok' : 'bad') + '">' + (ok ? '正常' : '异常') + '</td>'
          + '<td>' + esc((x.resource_count || 0).toLocaleString()) + '</td>'
          + '<td>' + esc(x.responseTime || '-') + ' ms</td>'
          + '<td><span class="act" onclick="useApi(\\'' + esc(x.api) + '\\')">测试</span>'
          + '<span class="act" onclick="copyApi(\\'' + esc(x.api) + '\\')">复制代理地址</span></td></tr>';
      }).join('');
      document.getElementById('list').innerHTML = rows;
      document.getElementById('listStat').textContent =
        '共 ' + (data.resources || []).length + ' 个源站 · 监测时间 ' + esc(data.timestamp || '-');
    })
    .catch(function (e) {
      document.getElementById('list').innerHTML = '<tr><td colspan="5" class="bad">列表加载失败：' + esc(e.message) + '</td></tr>';
    });

  function useApi(u) {
    document.getElementById('target').value = u; runTest();
    location.hash = ''; window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function copyApi(u) {
    navigator.clipboard.writeText(ORIGIN + '/?url=' + encodeURIComponent(u));
    alert('代理地址已复制');
  }
</script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
