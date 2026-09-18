# coffeemap

基于 React + Vite + 高德地图的附近地点探索网页，可以查询附近的咖啡店、网吧和按摩店，并查看评分、图片、价格和导航入口。

## 本地运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

## CloudBase 部署

当前部署环境：`coffeemap-prod-d7gyys53d1a4cee03`

首次部署前登录 CloudBase 并切换到目标环境：

```bash
tcb login
tcb env use coffeemap-prod-d7gyys53d1a4cee03
```

部署 CloudBase Web 应用：

```bash
npm run deploy:cloudbase
```

部署配置位于 `cloudbaserc.json`。它从本地 `.env` 读取 `VITE_AMAP_KEY`，只把构建所需变量注入 CloudBase，不会上传 `.env` 文件。

CloudBase 静态托管配置：

- 构建命令：`npm run build`
- 输出目录：`dist`
- 首页文档：`index.html`
- 部署路径：`/`
- 环境变量：`VITE_AMAP_KEY`

不要把真实的高德 Key 写入 Git。使用 CloudBase 在线构建时，在 CloudBase 的构建环境变量中配置 `VITE_AMAP_KEY`；本地构建则使用项目根目录的 `.env` 文件。

控制台入口：

https://tcb.cloud.tencent.com/dev?envId=coffeemap-prod-d7gyys53d1a4cee03#/static-hosting
