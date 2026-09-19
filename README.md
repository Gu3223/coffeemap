# 半醒半松（coffeemap）

“半醒半松”是一个基于 React、Vite、高德地点数据和 Leaflet 地图的附近地点探索网页，帮助用户在真实当前位置附近寻找咖啡店和按摩店，并查看评分、图片、价格、标签和导航入口。名字对应两个分类：**醒**是咖啡，**松**是按摩；两个分类的切换按钮就叫「醒」和「松」，圆形标志是「半」。

## 项目地址

- GitHub：<https://github.com/Gu3223/coffeemap>
- 线上网站：<https://coffeemap-coffeemap-prod-d7gyys53d1a4cee03.webapps.tcloudbase.com/>
- CloudBase 控制台：<https://tcb.cloud.tencent.com/dev?envId=coffeemap-prod-d7gyys53d1a4cee03#/static-hosting>

## 当前功能

- 页面打开后自动请求浏览器真实位置
- 未获得位置时不请求其他区域的数据
- 默认只查询当前位置 500 米内，可切换 500 米、1 公里、2 公里和 5 公里
- 使用高精度定位，并显示定位误差提示
- 咖啡店搜索使用高德 POI 分类「咖啡厅」（typecode `050500`）按类别精确检索，不再按名称关键词匹配，因此星巴克、M Stand 这类名称里不含「咖啡」的门店也能搜到；关键词仅在分类检索返回空时作为兜底
- 点击任意门店卡片即可打开详情抽屉，抽屉里可翻看高德返回的全部门店图片（2 公里样本里 325/369 家有图，其中 303 家是多图）
- 打开抽屉时额外补拉一次高德 POI 详情（服务端代理 `/api/place-detail`，只接受真实 POI id）。实测收益：**约六成门店能补上「今日营业时间」**；电话与图片基本补不到（8 家样本里电话 0 家、图片 0 家增益），拿不到就不显示，抽屉保留基础信息且不会报错
- 高德详情里的 `atag` 字段虽然 8/8 家都有，但内容只是「咖啡」「饮品」这类与 `keytag` 重复的粗标签，因此刻意不使用，避免给每张卡片加冗余标签
- 详情抽屉提供「我的标记」：适合学习 / 不适合 + 安静、有插座、Wi-Fi、适合久坐、人少 五个属性 + 一句备注。**数据只存在本机浏览器，不上传**，因此列表筛选「我标记适合」给出的是你自己确认过的结果，而不是猜的
- 高德不提供「是否适合学习」字段，所以另有一组「高德推断适合 / 高德推断不适合」标签，是对名称、类型与标签的推断，仅供参考，与「我的标记」明确区分
- **连锁品牌沉底**：星巴克、瑞幸、Manner 这类大型连锁排到列表后面，独立小店优先出现；卡片上有低调的「连锁」标记，另有「只看独立店」筛选。识别逻辑在 `src/chains.js`，只按门店名称匹配（高德的 `keytag` 一律是「咖啡」、`alias` 多数为空，名称是唯一稳定信号）。这是启发式，判错只影响顺序，不会隐藏门店
- 分类切换按钮保持「咖啡 / 按摩」两个词，品牌名「半醒半松」只用在标题与字标上
- 评价正文高德 API 不提供（`show_fields` 只有 business/indoor/navi/photos/children，`place/detail` 也只多给 atag/navi/indoor），因此详情抽屉提供跳转高德门店页与小红书的入口，由第三方页面展示评价
- 地图标记按缩放级别聚合：同一格子内的门店合并成「N 家」圆圈，放大后自动散开。市中心 500 米内动辄 40+ 家店，逐个画标记会糊成一团看不出任何信息。格子在屏幕上约 58 像素，多店聚合的落点取成员重心（直接用代表门店坐标会让相邻两格的标记互相压住），单个门店仍画在真实坐标上
- 首屏布局用 flex 让列表自动占满剩余高度，不再依赖 `calc(100vh - 291px)` 这类硬编码（原来 hero 实际约 316px，与 291px 不符，整页多出约 100px 溢出，列表和地图都被折叠线切掉）
- 高德限制单个圆形区域最多返回 200 条（官方原文「同请求参数翻页查询最多支持获取200条数据」），触及上限时自动改用「中心 + 6 片环形分片」继续检索：2 公里实测 369 家，单圆只有 191 家
- 配额提醒：高德基础搜索服务（含周边搜索）个人认证开发者 **5,000 次/月、QPS 3**，日配额已于 2025-05-20 取消。一次 500 米搜索约 2 次请求，一次 2 公里搜索最多 32 次请求；分片结果缓存 10 分钟，重复搜索不再消耗配额
- 结果默认按距离从近到远排序，也可以切换为评分优先
- 仅保留咖啡和按摩两个分类，已移除网吧分类
- 显示高德评分、评价数量、图片、营业信息、价格和地址；高德偶尔返回 0.4 这类极低评分，低于 2 分时显示「评分较少」而不是渲染成 0 颗星
- 咖啡店提供“适合学习 / 不建议学习 / 未判断”参考标签
- 按摩店提供“信息较完整 / 信息较少”参考标签，不代表对服务资质的保证
- 支持收藏、详情抽屉和跳转高德导航
- 收藏会真正保存下来（存在本机浏览器，和「我的标记」同一套存储层），顶部「我的收藏」可以点开查看。收藏时存的是门店快照而不只是 id，因此离开该区域、列表里不再有这家店时依然打得开；显示的距离按当前位置重新计算，不会一直显示当初收藏时的距离
- 详情页提供小红书搜索入口；当前是跳转搜索，不是小红书官方数据接口

## 口碑推荐（人工策展）

应用里的「口碑推荐」是一条**独立的加分依据**，与高德评分、距离、是否连锁互不干扰。它解决的问题是：高德只给评分，不给评价正文，也没有「哪些店被反复推荐」这类信息。

**数据从哪来（重要）**：只接受合法来源。

- 你自己刷小红书、刷点评时记下的店（**人读不算抓取**）；
- 公开榜单、文章里反复出现的店名（只记分数与来源链接，**不抄正文、不存图**）；
- 将来若有官方开放平台权限，走正规 API。

**为什么不自动抓小红书**：其 `robots.txt` 对 `User-agent: *` 是 `Disallow: /`，只放行搜索引擎爬虫；搜索结果页还是前端渲染 + 登录态 + 签名接口，实测拿不到内容；抓取 UGC 再发布还涉及用户著作权与平台协议。

**数据格式**：写在 [`src/curated-places.json`](./src/curated-places.json)，一条一项：

```json
[
  {
    "amapPoiId": "B0L0LM8N6M",
    "name": "愿景100咖啡",
    "score": 9,
    "source": "小红书 @某某 2026-09",
    "note": "手冲稳，靠窗位安静"
  }
]
```

- `amapPoiId` 可选但最好给，匹配最准；`name` 必给，作为兜底。
- `score` 为 0-10，超出范围会被夹紧。
- `source` 必给，会显示在详情抽屉里；`note` 可选，自己写，不要抄原文。

**匹配规则**：先按 POI id 精确匹配，失败再按名称匹配（名称做归一化：去括号内容、去标点、转小写，并用包含判断，所以「申·CAFE(人民广场店)」能匹配到「申·CAFE」）。**匹配失败只是不加分，不会隐藏门店**。

**界面上有三个入口**：卡片上的橙色「口碑推荐」标记、筛选里的「口碑推荐」、排序按钮切到「口碑优先」（距离优先 / 评分优先 / 口碑优先 三态循环）。详情抽屉里显示口碑分、短评与来源。

当前清单为**空**，因此线上看不到任何标记——填入数据后自动生效。

## 技术栈

- React + Vite
- Leaflet + React Leaflet
- Lucide React
- 高德地图 Web 服务地点搜索 API
- CloudBase Web 应用部署
- 字体：中文标题 **思源宋体**（Noto Serif SC），拉丁大字 **Bodoni Moda**（Didone 高对比），正文与店名 **Inter**（中文回退系统雅黑），数字与标签 DM Mono。字体经 `styles.css` 顶部的 Google Fonts `@import` 引入，中文按 unicode-range 切片按需下载

## 本地运行

需要 Node.js 和 npm。

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

本地预览生产构建：

```bash
npm run preview
```

## 高德 Key 配置

高德 Key 现在**只存在服务端**：它保存在云函数 `amap-nearby` 的环境变量 `AMAP_KEY` 里，不再下发到浏览器。前端只拿到一个代理地址，所以打开 F12 也抄不到 Key。

本地 `.env` 里仍保留 `VITE_AMAP_KEY`，有两个用途：

```env
VITE_AMAP_KEY=你的高德Web服务Key
VITE_AMAP_PROXY=https://coffeemap-prod-d7gyys53d1a4cee03-1491257715.ap-shanghai.app.tcloudbase.com/api/nearby
VITE_AMAP_DETAIL_PROXY=https://coffeemap-prod-d7gyys53d1a4cee03-1491257715.ap-shanghai.app.tcloudbase.com/api/place-detail
```

- 部署云函数时，`cloudbaserc.json` 通过 `{{env.VITE_AMAP_KEY}}` 把它注入函数环境变量（文件里不写明文，因为它会被提交进 Git）；
- `VITE_AMAP_PROXY` 是附近搜索的代理，`VITE_AMAP_DETAIL_PROXY` 是门店详情的代理。两个云函数共用同一把服务端 Key；
- 想把前端临时切回「直连高德」的老模式，注释掉 `VITE_AMAP_PROXY` 那一行即可（详情增强会自动降级，抽屉只显示基础信息）。

`.env` 已被 Git 忽略，真实 Key 不应写进 GitHub。两个云函数的完整说明见 [`functions/amap-nearby/README.md`](./functions/amap-nearby/README.md)。

## CloudBase 部署

当前 CloudBase 配置：

| 配置项 | 内容 |
| --- | --- |
| 环境 ID | `coffeemap-prod-d7gyys53d1a4cee03` |
| 应用服务名 | `coffeemap` |
| 当前线上版本 | `coffeemap-014` |
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |
| 构建环境变量 | `VITE_AMAP_PROXY`、`VITE_AMAP_DETAIL_PROXY`（高德 Key 已移到云函数，不再进前端包） |
| 云函数 | `amap-nearby`（路由 `/api/nearby`）、`amap-place-detail`（路由 `/api/place-detail`） |

首次使用时登录并切换环境：

```bash
tcb login
tcb env use coffeemap-prod-d7gyys53d1a4cee03
```

部署 Web 应用：

```bash
npm run deploy:cloudbase
```

改动了 `functions/` 之后，还要部署云函数（会自动创建/更新网关路由）：

```bash
npm run deploy:fn
```

部署配置位于 [`cloudbaserc.json`](./cloudbaserc.json)：`app` 段声明 Web 应用的构建环境变量，`functions` 段声明两个云函数 `amap-nearby` 与 `amap-place-detail`（Key 都以 `{{env.VITE_AMAP_KEY}}` 引用，不写明文）。它不会上传本地 `.env` 文件。

## GitHub 同步

每次完成代码修改后，提交并同步到 `main` 分支：

```bash
git status
git add .
git commit -m "描述本次修改"
git push origin main
```

查看历史记录：

```bash
git log --oneline --decorate
git show 提交号
```

本项目近期关键提交：

- `d4f1c35`：修复高德请求频率限制
- `39960af`：增加 CloudBase 部署配置
- `efa6b3f`：清理旧 Git 元数据和过期入口文件
- `9881d94`：优化精确定位和附近地点搜索
- `91e119a`：附近搜索改为按 POI 分类检索 + 环形分片（2 公里召回 191 → 369 家）
- `4f628a6`：新增服务端代理云函数（`functions/amap-nearby`）
- `d29560e`：前端切到代理模式，高德 Key 移出浏览器
- `631c3f5`：给代理路由加限流并记录部署细节
- `f973d2c`：代理收紧为「只按分类查询」，不再接受调用方自选的 `types`/`keywords`
- `a7a5fb3`：新增「我的标记」（本地存储）
- `f015aab`：补完门店详情增强，并修掉它弄坏的构建
- `d2fa8b2`：收藏持久化，导航「我的收藏」可用
- `b9d54c2`：视觉打磨（首屏折叠线、筛选行截断、地图标记聚合）
- `17b6ad9`：改名「半醒半松」并换字体系统
- `854e551`：字标降字重、店名改黑体、配色降饱和

## 新对话继续开发

如果新建对话，可以直接发送：

> 继续开发“半醒半松”项目。GitHub 仓库是 https://github.com/Gu3223/coffeemap ，线上地址是 https://coffeemap-coffeemap-prod-d7gyys53d1a4cee03.webapps.tcloudbase.com/ 。请基于 `main` 分支最新代码修改，完成后同步 GitHub，并部署 CloudBase。

## 重要说明

- 浏览器定位需要用户授权，并且线上环境必须使用 HTTPS。
- 用户拒绝定位或定位失败时，应用不会使用默认城市或其他坐标代替。
- 地点、评分、图片和价格均依赖高德返回的数据，部分门店可能没有完整字段。
- 地图底图使用 OpenStreetMap；门店地点数据使用高德。
- 咖啡店和按摩店的分类标签是基于公开 POI 信息的辅助判断，仅供参考。
