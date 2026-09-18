/**
 * 云函数：高德周边搜索代理（amap-nearby）
 *
 * 目的：把高德 Web 服务 Key 从浏览器里挪到服务端，消除「任何人打开 F12 就能抄走 Key 并盗刷配额」的问题。
 *
 * 设计取舍：这一层只做「转发 + 白名单 + 补 Key」，不搬运检索逻辑。
 * 因为多圆心分片、去重、半径过滤、缓存这些逻辑已经在前端 src/amapSearch.js 里验证过了，
 * 复制一份到服务端会出现两份实现、迟早不一致。代价是每次搜索的请求数不变（2 公里最多 32 次），
 * 也就是每次搜索最多触发 32 次函数调用 —— 如果之后想降到 1 次，需要把整个检索逻辑搬到服务端。
 *
 * 严格白名单的意义：这是公网可访问的端点，如果原样转发所有查询参数，
 * 别人就能拿它当免费的高德任意接口代理。这里只放行周边搜索真正需要的 8 个参数。
 */

const AMAP_ENDPOINT = 'https://restapi.amap.com/v5/place/around'
const ALLOWED_PARAMS = ['location', 'radius', 'types', 'keywords', 'sortrule', 'page_num', 'page_size', 'show_fields']

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'content-type': 'application/json; charset=utf-8'
}

/** 兼容不同事件封装：HTTP 访问服务通常给 queryStringParameters，也可能给 queryString 或带 ? 的 path。 */
function readQuery(event) {
  if (event && event.queryStringParameters && typeof event.queryStringParameters === 'object') return event.queryStringParameters
  const raw = (event && event.queryString) || (typeof event?.path === 'string' && event.path.includes('?') ? event.path.slice(event.path.indexOf('?') + 1) : '')
  const params = {}
  for (const [name, value] of new URLSearchParams(raw || '')) params[name] = value
  return params
}

function reply(statusCode, payload) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) }
}

exports.main = async (event = {}) => {
  const method = String(event.httpMethod || event.requestContext?.httpMethod || 'GET').toUpperCase()
  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' }

  const key = process.env.AMAP_KEY || process.env.VITE_AMAP_KEY || ''
  if (!key) return reply(500, { status: '0', info: 'PROXY_MISSING_KEY', infocode: '0' })

  const query = readQuery(event)
  const params = new URLSearchParams({ key })
  for (const name of ALLOWED_PARAMS) {
    const value = query[name]
    if (value != null && value !== '') params.set(name, String(value))
  }
  if (!params.get('location')) return reply(400, { status: '0', info: 'MISSING_LOCATION', infocode: '0' })

  try {
    const response = await fetch(`${AMAP_ENDPOINT}?${params}`, { signal: AbortSignal.timeout(15000) })
    // 原样透传高德响应体，前端的 status/infocode 处理逻辑无需改动
    return { statusCode: response.status, headers: CORS_HEADERS, body: await response.text() }
  } catch (error) {
    return reply(502, { status: '0', info: `UPSTREAM_ERROR:${error.message}`, infocode: '0' })
  }
}
