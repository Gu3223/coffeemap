# AGENTS.md — 半醒半松 项目上下文

压缩版记忆文件。新会话/新 agent 先读这里，不必翻完整对话。

## 是什么

附近咖啡店与按摩店查询。两套前端，一套逻辑。
- 网页：React + Vite + Leaflet，静态部署 CloudBase
- 小程序：Taro + React，AppID `wxe7c9c0085e7f7ee8`
- 数据：高德 Web 服务（Key 只在服务端）

## 仓库结构

- `shared/` 逻辑层，两端共用。**不读 `import.meta.env`、不碰 `localStorage`、不依赖 DOM、不直接调全局 `fetch`**
- `src/` 只剩 `main.jsx` + `styles.css`（网页 UI）
- `miniprogram/` Taro 工程，`config/index.js` 别名 `@shared` 指向 `../../shared`
- `functions/` 云函数：`amap-nearby`、`amap-place-detail`、`amap-js-proxy`

## 平台注入（唯一分叉点）

```js
configureAmapSearch({ key, proxyUrl, fetchImpl })   // shared/amapSearch.js
configureAmapDetails({ proxyUrl, fetchImpl })       // shared/amapDetails.js
setDefaultStorage(wxStorageLike)                    // shared/localStore.js
```

网页入口 `src/main.jsx` 与小程序入口 `miniprogram/src/platform.js` 各注入一次。未注入时明确抛 `MISSING_AMAP_KEY` / `DETAIL_PROXY_UNAVAILABLE` / `NO_FETCH_IMPLEMENTATION`，不静默失败。

小程序无 `fetch`，`platform.js` 把 `Taro.request` 包成 fetch 形态（只用 `ok` / `status` / `json()` / `text()`），并把 `AbortSignal` 映射到 `task.abort()`。

## 实测数字（都验证过，别凭感觉改）

- 高德单圆硬上限 **200 条**（官方原文：同请求参数翻页最多 200）。环形分片「中心 + 6 片 @0.6R」把 2 公里召回从 191 提到 **369**
- QPS 上限 **3/秒**。实测 330ms 间隔触发 `CUQPS_HAS_EXCEEDED_THE_LIMIT`(10021)，故请求间隔取 **360ms**
- 配额 **5,000 次/月**（个人认证），日配额 2025-05-20 取消。500m 搜索约 2 次请求，2km 最多 32 次
- `types=050500`（咖啡厅）优于关键词：唯一结果 **191 vs 72**，且能捞到星巴克、M Stand
- `count` 字段不可信（返回单页条数，非总数），旧实现因此只拿到 25 条
- 25 家样本：有图 19、有评分 25、有营业时间 20、电话 **0**
- 详情接口增益（8 家样本）：今日营业时间 **5/8**；电话 0/8；图片 0/8；`atag` 8/8 但与 `keytag` 重复，刻意不用
- 口碑清单 93 条广州门店，64 条已解析 `amapPoiId`。实测命中 20/93 —— 主因是采样截断（每圆只取最近 200 家），不是规则错

## 契约与防护

- 代理模式前端只发 `category`（`cafe` / `massage`），`types`/`keywords` 由服务端映射，半径夹到 5000、翻页夹到 8
- 云函数 `readQuery` 同时认 HTTP 网关的 `queryStringParameters` 与 `wx.cloud.callFunction` 的扁平对象；扁平形态下排除 `userInfo` 等平台字段
- 路由 `/api/nearby` 限流 `qpsTotal: 6`、单客户端 4
- 高德 Key 只在云函数环境变量。前端 bundle 内**无 Key**（每次部署都验证）
- 小程序上传私钥在**仓库外** `~/.config/wechat/private.wxe7c9c0085e7f7ee8.key`，`.gitignore` 已挡 `*.key`。仓库公开，泄漏即可被别人上传代码

## 上线状态

- 网页 CloudBase 应用 `coffeemap`，网关域名 `coffeemap-prod-d7gyys53d1a4cee03-1491257715.ap-shanghai.app.tcloudbase.com`
- 部署：`npm run deploy:cloudbase`（网页）、`npm run deploy:fn`（两个云函数）
- 小程序：`cd miniprogram && npm run build:weapp`，再 `node scripts/upload.js` 上传

## 小程序待办（都在微信后台，需人工）

1. 上传报 `errCode -10008, invalid ip: 58.249.115.234` → 后台「开发管理 → 开发设置 → 小程序代码上传」把该 IP 加入白名单，或关白名单
2. 申请「获取位置」接口（不申请 `getLocation` 直接失败）
3. 填《用户隐私保护指引》声明收集位置信息（不填拒审）
4. 类目选**工具**类（个人主体无餐饮/生活服务）
5. 名称「半醒半松」查重
6. `web-view` 个人主体不可用；建议走 `wx.cloud.callFunction`，免备案域名

## 坑（都踩过，别再踩）

- **`--httpFn` 不能加**：那是 Web 函数模式，要 `scf_bootstrap`，与 `exports.main(event)` 不兼容，函数根本不会创建
- 网关域名带 APPID 后缀（`-1491257715`）。`service.tcloudbase.com` 返回 `INVALID_PATH`，看着像"域名对了没配路由"，实际是域名不对。用 `tcb domains ls` 确认
- `tcb routes edit` 会弹 `(Y/n)` 确认；stdin 非终端时**静默不生效**。用管道喂 `Y`，并用 `routes list --json` 复核（注意键名是 PascalCase）
- 并发部署顺序：**函数先于前端**。2026-09-19 出现过前端先上、函数仍是旧契约，导致页面静默显示所有类型 POI
- 小程序构建把**所有非 ASCII 转成 `\uXXXX`**，在 `dist/` 搜中文搜不到，属正常
- 仓库根目录跑 dev server 时被编辑工具的「临时文件 + 改名」写入搞崩（`EBUSY ... .tmpdir`）。视觉迭代改用 `vite build` + `vite preview`
- 小程序构建需补 `npm install -D "@babel/preset-react@^7" "@babel/preset-env@^7"`；装 8.x 会 `ERESOLVE`（Taro 4 用 `@babel/core@7`）
- `git commit -m` 的信息里**别放双引号**（如 JSON 片段）：PowerShell 拆参，报 `pathspec ... did not match`，提交失败但不显眼
- GitHub 连接间歇性重置。推送用重试循环

## 数据来源合规

小红书**不抓**：其 `robots.txt` 对 `User-agent: *` 是 `Disallow: /`；搜索页是 JS + 登录墙；抓 UGC 再发布涉及著作权与平台协议。口碑清单只收合法来源（用户自读笔记、公开榜单的店名与链接，不抄正文、不存图）。
