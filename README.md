# API 代理加速（EdgeOne Pages 边缘函数）

作为代理转发加速访问资源采集站 API。源站 API 无需任何改动，把请求地址换成代理地址即可，返回内容与源站一致，并额外附加了 CORS 跨域头（浏览器端可直接调用）。

## 用法

```
源站：https://bfzyapi.com/api.php/provide/vod/?ac=list
代理：https://<你的域名>/?url=https%3A%2F%2Fbfzyapi.com%2Fapi.php%2Fprovide%2Fvod%2F%3Fac%3Dlist
```

- `url` 参数为源站完整地址（需 URL 编码）
- 任意路径均可触发转发：`/?url=`、`/proxy?url=` 等写法等价
- 直接访问根路径 `/` 会打开使用说明首页（含在线测试、源站健康列表）
- 支持 GET / POST / HEAD / OPTIONS，POST 会透传请求体
- 响应自动附加 `Access-Control-Allow-Origin: *`，解决源站不支持跨域的问题

## 目录结构

```
edge-functions/
├── index.js          # 根路由 /（处理 /?url=）
├── [[default]].js    # 多级 catch-all 路由（处理任意路径 ?url=）
└── _lib.js           # 核心代理逻辑 + 首页渲染
```

## 部署步骤 A：阿里云函数计算 FC（推荐，无需自有域名）

> 免费额度（所有用户每月）：100 万次调用 + 40 万 CU·s。函数 URL（fcapp.run）长期公开，无需备案、无需自有域名，国内访问快。
> 注意：免费额度不含**公网出流量**（0.8 元/GB），纯 JSON 接口个人使用每月约几毛到几元，账户保持少量余额即可。

1. 注册阿里云并完成实名认证，开通[函数计算 FC 3.0](https://fcnext.console.aliyun.com)
2. 控制台「创建函数」→ 类型选 **Web 函数** → 运行环境 **Node.js 18** 或以上 → 地域就近选择（如华东1-杭州）
3. 代码上传方式选「上传 zip 包」，上传仓库中的 `api-proxy-fc.zip`（内容：`fc-server.js` + `edge-functions/` + `package.json`）
4. 启动命令填 `node fc-server.js`，监听端口 9000，内存 512MB，请求超时 60 秒 → 创建
5. 函数详情页 → 「函数 URL」→ 开启公网访问，得到 `https://xxxx.<region>.fcapp.run` 长期有效的公网地址
6. 用法同上：`https://xxxx.fcapp.run/?url=<源站地址>`
7. （可选）配置环境变量 `PROXY_TOKEN` 开启鉴权，防止代理被滥用

## 部署步骤 B：腾讯 EdgeOne Pages（免费，但默认域名带签名）

> 仓库地址：https://github.com/consoleaiden/ApiProxy
> 注意：CLI 直传（`edgeone pages deploy`）创建的项目，默认域名（*.edgeone.dev / *.edgeone.cool）是带时效签名的预览链接，无法公开调用；必须用下面的 Git 集成方式创建项目，或绑定自定义域名。

方式一（Git 集成，推荐）：

1. 注册/登录 [EdgeOne Pages 国际版控制台](https://console.tencentcloud.com/edgeone/pages)
2. 「创建项目 → 导入 Git 仓库」→ 授权 GitHub → 选择 `consoleaiden/ApiProxy`（main 分支）
3. 构建配置：**构建命令留空、输出目录留空**（纯边缘函数项目，无需构建）
4. 部署完成后获得默认生产域名，即可按上面的用法调用
5. （可选）项目设置 → 域名管理 → 添加自定义域名，按提示加 CNAME 解析（海外区域免备案）

方式二（CLI 直传，适合临时预览）：

```bash
npm install -g edgeone
edgeone switch --site global   # 浏览器授权登录国际版
edgeone pages deploy . -n api-proxy -a overseas --json
```

返回的 Deploy URL 带 `eo_token` 签名参数，仅限时预览用，不能作为长期 API 端点。

## 安全配置（强烈建议）

`edge-functions/_lib.js` 顶部有两个开关，防止代理被陌生人白嫖滥用（免费额度被刷完后你的业务会受影响）：

```js
const PROXY_TOKEN = null;   // 改为 '你的密钥' 后，所有请求必须带 &key=你的密钥
const ALLOWED_HOSTS = null; // 改为 ['bfzyapi.com', ...] 后仅允许转发白名单源站
```

也可不改代码，直接在 EdgeOne 控制台为项目配置环境变量 `PROXY_TOKEN`，效果相同。

## 风险提示与常见坑

- **免费额度**：EdgeOne Pages 免费版边缘函数 300 万次请求/月、CPU 时间 300 万 ms/月。公开无鉴权的代理很容易被扫到滥用，建议启用 `PROXY_TOKEN`
- **单次执行 CPU 时间 200ms 上限**：本代理只做转发不处理数据，正常不会触及；若源站响应极慢会触发 15s 回源超时（返回 502）
- **源站封禁**：边缘节点出口 IP 与你本机不同，个别采集站可能有风控，表现为回源 403/5xx
- **不要用代理访问内网/本地地址**：代码已限制仅 http/https 协议
- EdgeOne CLI 本地调试环境暂不支持 fetch 回源，请以线上实测为准

## 本地验证

```bash
node test/local-test.mjs   # 用 Node 模拟边缘运行时，实测代理转发、CORS、错误处理
```
