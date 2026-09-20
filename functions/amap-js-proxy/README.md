# 高德 JS API 安全代理

将 HTTP 网关前缀 `/api/amap-js/*` 指向本函数，并开启“路径透传”。前端把
`https://你的域名/api/amap-js/_AMapService` 配置为 `VITE_AMAP_JS_SERVICE_HOST`；`_AMapService` 是高德规定的固定前缀。函数只接受高德 `v3`、`v4`、`v5` 路径，固定转发到高德官方域名，
并在服务端添加 `AMAP_JS_SECURITY_CODE`。

环境变量：

- `AMAP_JS_SECURITY_CODE`：高德 Web 端（JS API）Key 配套安全密钥。
- `ALLOWED_ORIGINS`：逗号分隔的站点 Origin；生产环境应包含 CloudBase 网站域名。

高德 JS API Key 本身会出现在浏览器中，必须在高德控制台绑定正式站点域名。
