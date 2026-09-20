/**
 * 高德 JS API 安全代理。securityJsCode 只保存在服务端，且请求目标与路径均受限。
 */

const PATH_PREFIX = '/api/amap-js'
const ALLOWED_PATH = /^\/v[345]\/[A-Za-z0-9_./-]+$/

function requestPath(event = {}) {
  const raw = String(event.rawPath || event.path || event.requestContext?.path || '')
  const marker = raw.indexOf(PATH_PREFIX)
  return marker >= 0 ? raw.slice(marker + PATH_PREFIX.length) || '/' : raw
}

function requestQuery(event = {}) {
  if (typeof event.rawQueryString === 'string') return new URLSearchParams(event.rawQueryString)
  if (typeof event.queryString === 'string') return new URLSearchParams(event.queryString)
  return new URLSearchParams(event.queryStringParameters || {})
}

function allowedOrigin(event = {}) {
  const headers = event.headers || {}
  const origin = headers.origin || headers.Origin || ''
  const allowed = String(process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
  if (!allowed.length) return origin || '*'
  return allowed.includes(origin) ? origin : null
}

function reply(statusCode, body, origin, contentType = 'application/json; charset=utf-8') {
  return {
    statusCode,
    headers: {
      'access-control-allow-origin': origin || 'null',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'content-type',
      'content-type': contentType,
      'cache-control': 'no-store',
      vary: 'Origin'
    },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  }
}

exports.main = async (event = {}) => {
  const method = String(event.httpMethod || event.requestContext?.httpMethod || 'GET').toUpperCase()
  const origin = allowedOrigin(event)
  if (!origin) return reply(403, { status: '0', info: 'ORIGIN_NOT_ALLOWED' }, null)
  if (method === 'OPTIONS') return reply(204, '', origin)
  if (method !== 'GET') return reply(405, { status: '0', info: 'METHOD_NOT_ALLOWED' }, origin)

  const securityCode = process.env.AMAP_JS_SECURITY_CODE || ''
  if (!securityCode) return reply(500, { status: '0', info: 'PROXY_MISSING_SECURITY_CODE' }, origin)

  const path = requestPath(event)
  if (!ALLOWED_PATH.test(path) || path.includes('..')) return reply(400, { status: '0', info: 'UNSUPPORTED_PATH' }, origin)

  const params = requestQuery(event)
  params.delete('jscode')
  params.set('jscode', securityCode)
  const upstream = path.startsWith('/v4/map/styles') ? 'https://webapi.amap.com' : 'https://restapi.amap.com'

  try {
    const response = await fetch(`${upstream}${path}?${params}`, { signal: AbortSignal.timeout(15000) })
    const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8'
    return reply(response.status, await response.text(), origin, contentType)
  } catch (error) {
    return reply(502, { status: '0', info: `UPSTREAM_ERROR:${error.message}` }, origin)
  }
}
