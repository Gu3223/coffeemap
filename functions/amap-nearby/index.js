/**
 * 云函数：高德周边搜索代理（amap-nearby）
 *
 * 目的：把高德 Web 服务 Key 从浏览器里挪到服务端，消除「任何人打开 F12 就能抄走 Key 并盗刷配额」的问题。
 *
 * 为什么不是「通用转发」：这是公网可访问、且无需鉴权的端点。如果允许调用方自选 types/keywords，
 * 别人就能拿它当免费的高德任意接口代理（查酒店、查餐厅、批量抓数据），你的 5,000 次/月额度照样会被刷光。
 * 所以这里只接受本应用真正需要的**分类名**，types/keywords 由服务端映射，半径、翻页、每页条数、
 * 排序、返回字段全部在服务端固定或夹紧——这个端点最多只能查「附近咖啡店 / 附近按摩店」。
 *
 * 接口契约：
 *   GET /api/nearby?category=cafe|massage&location=<经度>,<纬度>&radius=<米>&page_num=<1-8>
 *
 * 兼容分支：2026-09-19 之前部署的前端 bundle 只会发 types/keywords。
 * 为让新旧前端能平滑交接，下面按**值精确匹配**接受这两种旧形态；等线上全是新前端后可删掉那两行。
 */

const AMAP_ENDPOINT = 'https://restapi.amap.com/v5/place/around'
const AMAP_PAGE_SIZE = 25
const AMAP_MAX_PAGE = 8
const MAX_RADIUS_METERS = 5000
const LOCATION_PATTERN = /^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/

const CATEGORY_MAP = {
  cafe: { types: '050500' },
  massage: { keywords: '按摩|推拿|足疗|SPA' }
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'content-type': 'application/json; charset=utf-8'
}

/** 兼容不同事件封装：HTTP 访问服务通常给 queryStringParameters，也可能给带 ? 的 path。 */
function readQuery(event) {
  if (event && event.queryStringParameters && typeof event.queryStringParameters === 'object') return event.queryStringParameters
  const raw = (event && event.queryString) || (typeof event?.path === 'string' && event.path.includes('?') ? event.path.slice(event.path.indexOf('?') + 1) : '')
  const params = {}
  for (const [name, value] of new URLSearchParams(raw || '')) params[name] = value
  return params
}

/** 只认分类名；旧前端的 types/keywords 必须与预设值完全一致才放行，其余一律拒绝。 */
function resolveCategory(query) {
  const explicit = String(query.category || '')
  if (explicit) return Object.prototype.hasOwnProperty.call(CATEGORY_MAP, explicit) ? explicit : null
  if (query.types === CATEGORY_MAP.cafe.types) return 'cafe'
  if (query.keywords === CATEGORY_MAP.massage.keywords) return 'massage'
  return null
}

function clampInt(value, min, max, fallback) {
  const numeric = Number.parseInt(value, 10)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(Math.max(numeric, min), max)
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
  const category = resolveCategory(query)
  if (!category) return reply(400, { status: '0', info: 'UNSUPPORTED_CATEGORY', infocode: '0' })

  const location = String(query.location || '')
  if (!LOCATION_PATTERN.test(location)) return reply(400, { status: '0', info: 'MISSING_LOCATION', infocode: '0' })

  const params = new URLSearchParams({
    key,
    location,
    radius: String(clampInt(query.radius, 1, MAX_RADIUS_METERS, 500)),
    sortrule: 'distance',
    page_num: String(clampInt(query.page_num, 1, AMAP_MAX_PAGE, 1)),
    page_size: String(AMAP_PAGE_SIZE),
    show_fields: 'business,photos',
    ...CATEGORY_MAP[category]
  })

  try {
    const response = await fetch(`${AMAP_ENDPOINT}?${params}`, { signal: AbortSignal.timeout(15000) })
    // 原样透传高德响应体，前端的 status/infocode 处理逻辑无需改动
    return { statusCode: response.status, headers: CORS_HEADERS, body: await response.text() }
  } catch (error) {
    return reply(502, { status: '0', info: `UPSTREAM_ERROR:${error.message}`, infocode: '0' })
  }
}
