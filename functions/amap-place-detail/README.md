# amap-place-detail 云函数

高德 **POI 详情**的服务端代理。与 `amap-nearby` 同一个目的：把高德 Web 服务 Key 留在服务端，不下发到浏览器。

## 接口契约

```
GET /api/place-detail?id=<高德 POI ID>
```

- **只接受一个参数**：真实的 POI ID（形如 `B0L0LM8N6M`）。调用方不能传 key、关键词、地点类型或自定义返回字段，所以这个端点无法被当作通用高德代理使用。
- ID 用 `^B0[A-Za-z0-9]{4,30}$` 校验，不合法直接返回 `400 INVALID_POI_ID`，不消耗高德配额。
- 返回字段固定为 `show_fields=business,photos,navi,indoor,children`。
- 高德响应体原样透传，前端的 `status`/`infocode` 处理逻辑与搜索路径一致。

## 部署

```bash
npm run deploy:fn:detail
```

等同：

```bash
tcb fn deploy amap-place-detail -e coffeemap-prod-d7gyys53d1a4cee03 \
  --dir functions/amap-place-detail --path /api/place-detail \
  --runtime Nodejs20.19 --force
```

与 `amap-nearby` 一样：**不要加 `--httpFn`**（那是 Web 函数模式，要求 `scf_bootstrap`，与本目录的 `exports.main(event)` 写法不兼容）。`--path` 会自动创建网关路由。

Key 的注入方式与 `amap-nearby` 相同：`cloudbaserc.json` 的 `functions` 段用 `{{env.VITE_AMAP_KEY}}` 引用，函数里读 `process.env.AMAP_KEY`。未配置时返回 `500 PROXY_MISSING_KEY`，且不会请求高德。

## 实测收益（8 家门店样本）

| 字段 | 增益 |
|---|---|
| 今日营业时间 `opentime_today` | **5 / 8 家**能补上 |
| 电话 `tel` | 0 / 8 |
| 图片 `photos` | 0 / 8（详情接口返回的图片与搜索接口完全相同） |
| 楼层 `indoor` | 0 / 8 |
| `atag` | 8 / 8 都有，但内容只是「咖啡」「饮品」这类与 `keytag` 重复的粗标签，**刻意不使用** |

结论：这个接口的真实价值就是给约六成门店补上「今日营业时间」。拿不到就不显示，抽屉保留基础信息，不会因此报错。

## 前端接入

前端模块 `src/amapDetails.js`：只在门店有真实 POI ID 时才请求（我们自己兜底生成的「名称+坐标」ID 会 404），结果缓存 10 分钟，并与搜索得到的门店数据合并。打开详情抽屉时触发，失败只显示「详情暂时不可用，已保留基础信息」。

代理地址来自构建环境变量 `VITE_AMAP_DETAIL_PROXY`；未配置时模块抛 `DETAIL_PROXY_UNAVAILABLE`，抽屉不显示加载状态。
