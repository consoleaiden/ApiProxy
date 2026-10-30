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

## 部署步骤（腾讯 EdgeOne Pages，免费）

1. 代码托管：本仓库推送到 Gitee（EdgeOne 控制台 Git 集成目前支持 GitHub/GitLab/Bitbucket，Gitee 仓库可通过 CLI 方式部署，或镜像到 GitHub）
2. 注册并登录 [EdgeOne Pages 控制台](https://console.cloud.tencent.com/edgeone/pages)
3. 方式一（Git 集成）：把仓库镜像到 GitHub → 控制台「创建项目 → 导入 Git 仓库」→ 构建命令留空、输出目录留空（纯函数项目）→ 部署
4. 方式二（CLI 部署）：
   ```bash
   npm install -g edgeone
   edgeone login          # 浏览器授权登录
   edgeone pages deploy   # 在本项目根目录执行
   ```
5. 部署完成后获得 `https://<项目名>.edgeone.app` 地址，即可按上面的用法调用
6. （可选）控制台绑定自定义域名，国内访问更稳定

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
