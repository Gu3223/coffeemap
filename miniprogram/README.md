# 半醒半松 · 小程序端

字节数很少，因为**逻辑层不在这里**。检索、连锁识别、口碑匹配、本地标记、收藏全部在仓库根目录的 [`shared/`](../shared)，
与网页端共用同一份文件。这一层只做两件事：**平台适配**与**界面**。

## 目录

```
miniprogram/
  project.config.json     小程序配置，appid 已填 wxe7c9c0085e7f7ee8
  config/index.js         Taro 构建配置，别名 @shared 指向 ../../shared
  src/
    app.js                入口，渲染前先 setupPlatform()
    app.config.js         页面注册、位置权限说明、requiredPrivateInfos
    platform.js           平台适配：Taro 存储 + Taro.request 包成 fetch 形态
    pages/index/          列表页：定位、检索、连锁沉底、口碑标记
```

## 为什么能直接复用

`shared/` 里的模块不读 `import.meta.env`、不碰 `localStorage`、不依赖 DOM，也不直接调全局 `fetch`。
所有运行时依赖由 `src/platform.js` 注入一次：

```js
setDefaultStorage(wxStorageLike)                         // placeNotes / favorites 的底层存储
configureAmapSearch({ proxyUrl, fetchImpl })             // 检索层
configureAmapDetails({ proxyUrl, fetchImpl })            // 详情层
```

`fetchImpl` 把 `Taro.request` 包成 fetch 形态（逻辑层只用到 `ok` / `status` / `json()` / `text()`），
并把 `AbortSignal` 手动映射到 `task.abort()`，这样逻辑层的取消逻辑在小程序里也生效。

## 跑起来

```bash
cd miniprogram
npm install
npm run build:weapp        # 产物在 miniprogram/dist
```

然后用微信开发者工具 **导入项目**，目录选 `miniprogram/`，AppID 用 `wxe7c9c0085e7f7ee8`。
开发者工具会读取 `project.config.json`，自动指向 `dist/`。

开发时用 `npm run dev:weapp` 持续监听。

## 小程序侧还需要你在后台做的

1. **开通云开发并关联环境**（或继续用 HTTP 网关，见下）。
2. **申请「获取位置」接口**：开发管理 → 接口设置 → 地理位置。个人主体需填写使用场景说明。
3. **填写《用户隐私保护指引》**，声明收集位置信息。不填直接拒审。
4. **类目**：个人主体只能选工具类。功能描述写成「查询附近咖啡店与按摩店信息的工具」，不要写成推荐或预约服务。
5. **名称查重**：「半醒半松」需唯一。

## 请求域名：两条路

当前 `platform.js` 走 **HTTP 网关**：需要把域名加入小程序后台的「request 合法域名」，且该域名需 ICP 备案。

另一条路是 **`wx.cloud.callFunction`**：走微信内部通道，**不需要配置任何域名**。
两个云函数的 `readQuery` 已同时兼容两种入参形态（HTTP 网关的 `queryStringParameters` 与云调用的扁平对象），
所以切换只需在 `platform.js` 里把 `fetchLike` 换成基于 `Taro.cloud.callFunction` 的实现，云函数不用改。

个人主体建议走云调用这条路，省掉备案域名这个门槛。

## 界面

第一版只做了列表页：定位、半径切换（500m/1km/2km）、卡片显示名称、距离、地址、评分，以及「口碑推荐」「连锁」标记。
排序口径与网页端一致——连锁沉底，其余按距离。

网页端的地图（Leaflet）换成小程序 `map` 组件需要另做，标记聚合逻辑可以直接复用 `shared/mapClusters.js`。
