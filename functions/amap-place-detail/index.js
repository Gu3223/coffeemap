/**
 * 高德 POI 详情代理：只接受一个真实 POI ID，固定返回公开商业信息、图片和导航辅助字段。
 * 它不是通用高德代理，调用方无法传入 key、关键词、地点类型或自定义返回字段。
 */

const AMAP_ENDPOINT = 'https://restapi.amap.com/v5/place/detail'
const POI_ID_PATTERN = /^B0[A-Za-z0-9]{4,30}$/
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'content-type': 'application/json; charset=utf-8'
}

function readQuery(event) {
  if (event?.queryStringParameters && typeof event.queryStringParameters === 'object') return event.queryStringParameters
  const raw = event?.queryString || (typeof event?.path === 'string' && event.path.includes('?') ? event.path.slice(event.path.indexOf('?') + 1) : '')
  return Object.fromEntries(new URLSearchParams(raw || ''))
}

function reply(statusCode, payload) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) }
}

exports.main = async (event = {}) => {
  const method = String(event.httpMethod || event.requestContext?.httpMethod || 'GET').toUpperCase()
  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' }

  const key = process.env.AMAP_KEY || process.env.VITE_AMAP_KEY || ''
  if (!key) return reply(500, { status: '0', info: 'PROXY_MISSING_KEY', infocode: '0' })

  const id = String(readQuery(event).id || '')
  if (!POI_ID_PATTERN.test(id)) return reply(400, { status: '0', info: 'INVALID_POI_ID', infocode: '0' })

  const params = new URLSearchParams({
    key,
    id,
    show_fields: 'business,photos,navi,indoor,children'
  })

  try {
    const response = await fetch(`${AMAP_ENDPOINT}?${params}`, { signal: AbortSignal.timeout(15000) })
    return { statusCode: response.status, headers: CORS_HEADERS, body: await response.text() }
  } catch (error) {
    return reply(502, { status: '0', info: `UPSTREAM_ERROR:${error.message}`, infocode: '0' })
  }
}
