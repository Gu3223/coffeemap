# 寻一杯（coffeemap）

“寻一杯”是一个基于 React、Vite、高德地点数据和 Leaflet 地图的附近地点探索网页，帮助用户在真实当前位置附近寻找咖啡店和按摩店，并查看评分、图片、价格、标签和导航入口。

## 项目地址

- GitHub：<https://github.com/Gu3223/coffeemap>
- 线上网站：<https://coffeemap-coffeemap-prod-d7gyys53d1a4cee03.webapps.tcloudbase.com/>
- CloudBase 控制台：<https://tcb.cloud.tencent.com/dev?envId=coffeemap-prod-d7gyys53d1a4cee03#/static-hosting>

## 当前功能

- 页面打开后自动请求浏览器真实位置
- 未获得位置时不请求其他区域的数据
- 默认只查询当前位置 500 米内，可切换 500 米、1 公里、2 公里和 5 公里
- 使用高精度定位，并显示定位误差提示
- 咖啡店搜索覆盖“咖啡、咖啡馆、咖啡厅、咖啡店、精品咖啡、手冲咖啡、coffee、cafe”等关键词
- 结果默认按距离从近到远排序，也可以切换为评分优先
- 仅保留咖啡和按摩两个分类，已移除网吧分类
- 显示高德评分、评价数量、图片、营业信息、价格和地址
- 咖啡店提供“适合学习 / 不建议学习 / 未判断”参考标签
- 按摩店提供“信息较完整 / 信息较少”参考标签，不代表对服务资质的保证
- 支持收藏、详情抽屉和跳转高德导航
- 详情页提供小红书搜索入口；当前是跳转搜索，不是小红书官方数据接口

## 技术栈

- React + Vite
- Leaflet + React Leaflet
- Lucide React
- 高德地图 Web 服务地点搜索 API
- CloudBase Web 应用部署

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

在项目根目录创建 `.env`，内容如下：

```env
VITE_AMAP_KEY=你的高德Web服务Key
```

`.env` 已被 Git 忽略，真实 Key 不应写进 GitHub。高德 Key 需要开通 Web 服务相关权限，并配置正确的安全域名或服务端访问策略。

## CloudBase 部署

当前 CloudBase 配置：

| 配置项 | 内容 |
| --- | --- |
| 环境 ID | `coffeemap-prod-d7gyys53d1a4cee03` |
| 应用服务名 | `coffeemap` |
| 当前线上版本 | `coffeemap-004` |
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |
| 构建环境变量 | `VITE_AMAP_KEY` |

首次使用时登录并切换环境：

```bash
tcb login
tcb env use coffeemap-prod-d7gyys53d1a4cee03
```

部署 Web 应用：

```bash
npm run deploy:cloudbase
```

部署配置位于 [`cloudbaserc.json`](./cloudbaserc.json)。它会从 CloudBase 构建环境变量中读取 `VITE_AMAP_KEY`，不会上传本地 `.env` 文件。

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

## 新对话继续开发

如果新建对话，可以直接发送：

> 继续开发“寻一杯”项目。GitHub 仓库是 https://github.com/Gu3223/coffeemap ，线上地址是 https://coffeemap-coffeemap-prod-d7gyys53d1a4cee03.webapps.tcloudbase.com/ 。请基于 `main` 分支最新代码修改，完成后同步 GitHub，并部署 CloudBase。

## 重要说明

- 浏览器定位需要用户授权，并且线上环境必须使用 HTTPS。
- 用户拒绝定位或定位失败时，应用不会使用默认城市或其他坐标代替。
- 地点、评分、图片和价格均依赖高德返回的数据，部分门店可能没有完整字段。
- 地图底图使用 OpenStreetMap；门店地点数据使用高德。
- 咖啡店和按摩店的分类标签是基于公开 POI 信息的辅助判断，仅供参考。
