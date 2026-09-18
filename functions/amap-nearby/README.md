# amap-nearby 云函数

高德周边搜索的**服务端代理**。目的只有一个：把高德 Web 服务 Key 从浏览器里挪走，消除「任何人打开 F12 就能抄走 Key 并盗刷配额」的问题。

前端 `src/amapSearch.js` 支持两种取数模式，检索逻辑（多圆心分片、去重、半径过滤、缓存、限流）完全相同，只换请求出口：

| 模式 | 触发条件 | Key 位置 |
|---|---|---|
| 直连（现状） | 只配 `VITE_AMAP_KEY` | 被 Vite 内联进 bundle，公开可提取 |
| 代理 | 配 `VITE_AMAP_PROXY` | 只在云函数环境变量里，不下发前端 |

## 当前线上状态（已部署）

| 项 | 值 |
|---|---|
| 云函数 | `amap-nearby`（事件函数，Nodejs20.19） |
| 网关路由 | `/api/nearby` → SCF `amap-nearby`，域名 `*` |
| 限流 | `qpsTotal: 6`，单客户端（ClientIP）`limitValue: 4` |
| 安全域名校验 | 开启（`EnableSafeDomain: true`），白名单已含 `*.webapps.tcloudbase.com` |
| 身份认证 | 关闭（`EnableAuth: false`，匿名可调用） |
| 前端 | `coffeemap-006` 起走代理，bundle 内已无 Key |

## 部署

```bash
tcb fn deploy amap-nearby -e coffeemap-prod-d7gyys53d1a4cee03 \
  --dir functions/amap-nearby --path /api/nearby \
  --runtime Nodejs20.19 --force
```

- **不要加 `--httpFn`**。那个开关是「Web 函数」模式，要求目录里有 `scf_bootstrap` 启动文件（即自己起 HTTP 服务器的模型），与本目录 `index.js` 的 `exports.main(event)` 写法不兼容——加了它 CLI 会卡在「自动创建 scf_bootstrap 示例？」的交互提示上，且函数不会被创建。本函数走的是**事件函数 + HTTP 访问服务（网关）路由**：网关负责把 HTTP 请求转成 `event`，返回值含 `statusCode` 时自动按「集成响应」处理。
- `--path /api/nearby` 会自动创建网关路由（等价于 `tcb routes add`），无需单独执行。
- 入口必须是 `index.js` 且为 CommonJS（官方明确不支持直接用 ES Module）；本目录的 `package.json` 刻意不写 `"type": "module"`，以保证这一点。

## 配置 Key（服务端）

在云函数的**环境变量**里设置 `AMAP_KEY`（代码同时兼容 `VITE_AMAP_KEY`）。控制台路径：云函数 → amap-nearby → 配置 → 环境变量。

没有配置时函数返回 `500 PROXY_MISSING_KEY`，**不会**把请求打到高德。

## 网关域名（实测，踩过坑，以此为准）

本环境真正可用的网关域名是**带 APPID 后缀**的那个：

```
https://coffeemap-prod-d7gyys53d1a4cee03-1491257715.ap-shanghai.app.tcloudbase.com/api/nearby
```

用 `tcb domains ls` 可以看到它就是环境绑定的默认域名（`-1491257715` 是腾讯云 APPID）。踩过的两个坑：

| 尝试过的形式 | 实测结果 | 为什么会误判 |
|---|---|---|
| `<envId>-<APPID>.ap-shanghai.app.tcloudbase.com` | **可用**（正确的那个） | — |
| `<envId>.service.tcloudbase.com` | `INVALID_PATH` | 网关认识这个环境，但该域名下没有路由。**看起来像「域名对了只是没配路由」，实际是域名根本不对**，最容易把人带偏 |
| `<envId>.ap-shanghai.app.tcloudbase.com` | `INVALID_ENV` | 少了 APPID 后缀 |
| `<envId>.app.tcloudbase.com` | DNS 解析失败 | 少了 region 与 APPID |

**教训**：判断网关域名别只看错误码，要用 `tcb domains ls` 看环境实际绑定的域名。

## CORS 与安全域名（当前状态：已就绪，无需改动）

路由的安全域名校验是**开着**的（`EnableSafeDomain: true`），但**白名单里已经有 `*.webapps.tcloudbase.com`**（`tcb cors list` 可见，2026-06-03 加入的通配条目），所以前端所在域名本来就能通过。实测：带真实前端 Origin 请求该端点返回 **HTTP 200**，响应里还带函数自己写的 `access-control-allow-origin: *`。

因此本环境不需要任何额外配置。**换域名时要注意**：如果前端以后换到别的域名，必须把它加进「Web 安全域名」白名单，否则浏览器请求会被网关拦掉：

```bash
tcb cors add 你的新域名 -e coffeemap-prod-d7gyys53d1a4cee03
```

另外要清楚：安全域名校验只挡得住浏览器（非浏览器客户端可以伪造 Origin 头），它是抬高标准、不是绝对防线。

## 前端启用（顺序很重要）

**先部署函数并验证通过，再打开开关。** 在 CloudBase 构建环境变量里加：

```
VITE_AMAP_PROXY=https://coffeemap-prod-d7gyys53d1a4cee03.service.tcloudbase.com/api/nearby
```

确认线上一切正常后，即可从构建环境变量中**移除 `VITE_AMAP_KEY`**，前端 bundle 里就不再含有 Key。

## 验证

```bash
node -e "fetch('https://coffeemap-prod-d7gyys53d1a4cee03-1491257715.ap-shanghai.app.tcloudbase.com/api/nearby?location=121.4737,31.2304&radius=500&types=050500&page_num=1&page_size=1').then(r=>r.json()).then(d=>console.log(d.status,(d.pois||[]).length))"
```

应输出 `1 1`（status=1 且 1 条结果）。再检查线上 bundle 里搜不到那把 Key，即切换完成。

## 回滚

移除 `VITE_AMAP_PROXY` 即可回到直连模式，无需改动任何前端代码。

## 安全设计要点

- **参数严格白名单**：这是公网可访问端点，若原样转发所有查询参数，别人就能拿它当免费的高德任意接口代理。只放行周边搜索真正需要的 8 个参数（`location`、`radius`、`types`、`keywords`、`sortrule`、`page_num`、`page_size`、`show_fields`）。
- **调用方传入的 `key` 会被丢弃**：函数只用自己环境变量里的 Key。已实测：请求里带伪造 `key` 时仍正常返回结果，证明调用方无法替换 Key。
- **路由限流已配置**：`qpsPolicy = { qpsTotal: 6, qpsPerClient: { limitBy: 'ClientIP', limitValue: 4 } }`。取值理由：前端自己按 2.78 次/秒排队，单客户端放到 4 才有余量、不会误伤正常搜索（已实测：配上限流后 2 公里搜索仍拿到 369 家、0 越界）；总量 6 允许约两个用户并发。
  **必须清楚它的边界**：QPS 限制只能拖慢滥用，**挡不住细水长流式的配额消耗**——按 1 次/秒算，5,000 次/月的额度 83 分钟就能刷完。要真正封住只有两条路：给路由打开 `enableAuth` 要求 CloudBase 身份认证（代价是匿名访客用不了），或在服务端加按天/按月的额度闸（需要数据库或 KV 支持）。

## 本地测试（已通过）

不部署也能完整验证：用 Node 起一个本地 HTTP 服务器模拟网关（把 HTTP 请求转成云函数 event），让前端检索层走代理模式跑通端到端。已覆盖并通过：

- 正常 GET 返回高德结果；`OPTIONS` 预检返回 204 + CORS 头
- **调用方伪造 Key 被忽略**（走白名单丢弃，仍用服务端 Key）
- 缺 `location` 返回 400；未配置 Key 返回 500 且不请求高德
- `queryStringParameters` 与 `path` 带查询串两种入参形态都能解析
- 代理模式下前端**不把 Key 发给服务端**；分片缓存命中时新增请求为 0

## 已知代价

因为检索分片逻辑仍在前端，**每次 2 公里搜索最多触发 32 次函数调用**（500 米默认搜索约 2 次）。函数调用配额与高德配额是两套账，如果调用次数成为瓶颈，需要把整个检索逻辑搬到服务端，把每次搜索压成 1 次调用——那会带来一份重复实现，所以没在这次改动里做。
