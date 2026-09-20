/**
 * 附近地点检索层（高德 Web 服务 v5 周边搜索）
 *
 * 这里的关键参数不是拍脑袋来的，是 2026-09-18 用真实 Key 在上海人民广场实测（R2000）得出的：
 *   1. 单次查询硬上限 = 200 条（8 页 × 25，第 9 页必空）。想拿到更多必须换多个圆心。
 *   2. types=050500（咖啡厅）比关键词匹配强得多：唯一结果 191 vs 72，且能捞到
 *      星巴克、M Stand 这类名称里没有「咖啡」的真咖啡店（关键词法完全漏掉）。
 *   3. 响应里的 count 字段不可信：关键词查询返回 count=22 却有 75 条结果，
 *      用它做提前终止会把结果截断到首页 25 条（这是旧实现的真实缺陷）。
 *   4. QPS 上限就在 3 次/秒附近：330ms 间隔实测触发 CUQPS_HAS_EXCEEDED_THE_LIMIT(10021)，
 *      所以请求必须全局排队且间隔 ≥360ms，撞限流要退避重试。
 *   5. 环形分片（中心 + 6 片，环心距与片半径都取 0.6R）实测把 R2000 的召回
 *      从 191 提升到 522 家（2.7 倍）；片会越界到 1.2R，靠客户端按真实距离过滤保证精确。
 *
 * 两种取数模式（检索逻辑完全相同，只换请求出口）：
 *   - 直连：只配 VITE_AMAP_KEY，浏览器直接请求高德。Key 会被 Vite 内联进 bundle，任何人可提取。
 *   - 代理：配 VITE_AMAP_PROXY 指向自己的云函数（functions/amap-nearby），请求改发服务端，
 *     前端不再持有 Key。必须先部署云函数再打开这个开关。
 */

import { haversineKm } from './geo.js'

const AMAP_ENDPOINT = 'https://restapi.amap.com/v5/place/around'

/**
 * 运行时配置由平台层注入，本模块不直接读 import.meta.env。
 *
 * 两个原因：
 *   1. 小程序没有 import.meta.env，也没有 window；同一份检索逻辑要能直接搬过去；
 *   2. 脱离 Vite 也能在 Node 里跑测试，不必再替换源码字符串。
 * main.jsx（网页）与小程序入口各自调用一次 configureAmapSearch 即可。
 */
let runtimeConfig = { key: '', proxyUrl: '', fetchImpl: null }

export function configureAmapSearch(next = {}) {
  runtimeConfig = { ...runtimeConfig, ...next }
}

/**
 * 取请求实现。小程序里没有 fetch，平台入口传一个基于 wx.request 的适配实现即可；
 * 网页不传，默认用全局 fetch。默认值延迟到调用时取，便于 polyfill 或测试替换。
 */
function doFetch(...args) {
  const impl = runtimeConfig.fetchImpl || globalThis.fetch
  if (!impl) throw new Error('NO_FETCH_IMPLEMENTATION')
  return impl(...args)
}
const AMAP_PAGE_SIZE = 25
const AMAP_MAX_PAGE = 8
const AMAP_REQUEST_INTERVAL_MS = 360
const AMAP_RETRY_LIMIT = 2
const AMAP_CACHE_TTL_MS = 10 * 60 * 1000
const MAX_RESULTS = 400
const REQUEST_BUDGET = 32
const RING_MIN_GAIN = 12
const REFINE_GRID_RATIO = 0.6
const RING_CELL_COUNT = 6

const CATEGORY_SEARCH = {
  cafe: { types: '050500', keywords: ['咖啡', '咖啡馆', '咖啡厅', '咖啡店', '咖啡屋', '精品咖啡', '手冲咖啡', 'coffee', 'cafe'] },
  massage: { types: '', keywords: ['按摩', '推拿', '足疗', 'SPA'] }
}

const cellCache = new Map()

// 距离计算搬到 ./geo（收藏模块也要用，且那里不该依赖本模块的 import.meta.env）；此处继续对外导出，调用方无需改动
export { haversineKm }

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

let requestChain = Promise.resolve()
let lastRequestAt = 0

/** 全局串行排队：保证任意两次请求的起始间隔 ≥360ms，避开 QPS 限流。 */
function scheduleRequest(task) {
  const run = requestChain.then(async () => {
    const gap = lastRequestAt + AMAP_REQUEST_INTERVAL_MS - Date.now()
    if (gap > 0) await sleep(gap)
    lastRequestAt = Date.now()
    return task()
  })
  requestChain = run.then(() => undefined, () => undefined)
  return run
}

// 10019/10020/10021 是各级 QPS 超限，10004 是一分钟内访问过频，都可以退避重试；
// 10003（日配额）/10044（账号日配额）重试没有意义，直接抛给上层提示用户。
const RATE_LIMIT_INFOCODES = new Set(['10019', '10020', '10021', '10004'])
const isRateLimitError = error => RATE_LIMIT_INFOCODES.has(String(error?.infocode)) || /QPS|ACCESS_TOO_FREQUENT/i.test(error?.message || '')

// 代理模式下前端只报「分类 + 位置 + 半径 + 页码」四个值：types/keywords 由云函数映射，
// 排序、每页条数、返回字段也都在服务端固定。这样端点被他人拿到也只能查咖啡店和按摩店，
// 无法当作免费的高德通用接口使用。直连模式则照旧把完整参数发给高德。
function buildRequestUrl(params, category) {
  if (!runtimeConfig.proxyUrl) return `${AMAP_ENDPOINT}?${new URLSearchParams(params)}`
  const proxyParams = { category, location: params.location, radius: params.radius, page_num: params.page_num }
  return `${runtimeConfig.proxyUrl}?${new URLSearchParams(proxyParams)}`
}

async function requestPage(params, category, signal) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await scheduleRequest(async () => {
        const response = await doFetch(buildRequestUrl(params, category), { signal })
        if (!response.ok) {
          const error = new Error(runtimeConfig.proxyUrl ? 'PROXY_UNAVAILABLE' : `Amap HTTP ${response.status}`)
          if (runtimeConfig.proxyUrl) error.code = 'PROXY_UNAVAILABLE'
          throw error
        }
        const data = await response.json()
        if (data.status !== '1') {
          const error = new Error(data.info || 'Amap request failed'); error.infocode = data.infocode; throw error
        }
        return data
      })
    } catch (error) {
      const retryable = isRateLimitError(error) || error.code === 'PROXY_UNAVAILABLE'
      if (error.name === 'AbortError' || attempt >= AMAP_RETRY_LIMIT || !retryable) throw error
      await sleep(600 * (attempt + 1), signal)
    }
  }
}

function colorFor(index) { return ['#b87351', '#c2a05a', '#8d7867', '#a07b62', '#79806f'][index % 5] }

function priceInfo(value, category) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return { priceValue: null, priceLabel: null, priceLevel: '未知' }
  const suffix = category === 'massage' ? '起' : ''
  return { priceValue: numeric, priceLabel: `¥${numeric}${suffix}`, priceLevel: numeric < 50 ? '¥' : numeric < 150 ? '¥¥' : '¥¥¥' }
}

function classifyStudySuitability(poi, category) {
  if (category !== 'cafe') return { label: null, reason: null }
  const text = `${poi.name || ''} ${poi.type || ''} ${poi.business?.tag || ''}`.toLowerCase()
  if (/酒吧|ktv|夜店|live|电竞|club|bar/.test(text)) return { label: '不建议学习', reason: '门店信息显示可能存在较高噪音' }
  if (/自习|阅读|书店|共享空间|安静|study|reading|workspace|wifi|wi-fi/.test(text)) return { label: '适合学习', reason: '门店信息包含安静、阅读或 Wi-Fi 等特征' }
  return { label: '未判断', reason: '公开 POI 信息不足以判断环境' }
}

function classifyMassageProfile(poi, category) {
  if (category !== 'massage') return { label: null, reason: null }
  const business = poi.business || {}
  const complete = Boolean(poi.name && poi.address && (poi.tel || business.opentime || business.opentime_week))
  return { label: complete ? '信息较完整' : '信息较少', reason: complete ? '名称、地址和联系或营业信息较完整' : '部分地址、联系或营业信息缺失，建议到店前核实' }
}

function normalizeAmapPoi(poi, origin, index, category) {
  const [longitude, latitude] = (poi.location || '').split(',').map(Number)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  const business = poi.business || {}; const rating = Number(poi.rating ?? business.rating)
  const photos = (poi.photos || []).map(photo => photo.url).filter(Boolean)
  const pricing = priceInfo(business.cost || poi.cost, category)
  const study = classifyStudySuitability(poi, category); const massage = classifyMassageProfile(poi, category)
  const amapPoiId = poi.id || `${poi.name || 'poi'}-${poi.location || `${longitude},${latitude}`}`
  // 距离一律以「用户当前位置」为基准自己算：分片查询时高德返回的 distance 是相对分片圆心的，直接采用会算错距离。
  const distanceKm = haversineKm([origin.latitude, origin.longitude], [latitude, longitude])
  return { id: `amap-${amapPoiId}`, amapPoiId, name: poi.name || '未命名地点', address: poi.address || poi.pname || '地址未标注', category: category === 'massage' ? '按摩店' : poi.type?.split(';').pop() || '咖啡店', rating: Number.isFinite(rating) && rating > 0 ? rating : null, reviews: Number(business.rating_num || business.review_num) || null, distanceKm, open: null, openingHours: business.opentime_week || business.opentime || null, ...pricing, studySuitability: study.label, studyReason: study.reason, massageProfile: massage.label, massageReason: massage.reason, tags: [business.tag || null].filter(Boolean), image: photos[0] || null, photos, position: [latitude, longitude], color: colorFor(index), source: 'amap', tel: poi.tel || null }
}

/** 跨分片收集结果：按 id 去重、按「同名且 50m 内」判重（用 0.001° 空间桶避免 O(n²)），并按真实距离裁剪到半径内。 */
function createCollector(origin, radiusMeters, category, maxResults) {
  const byId = new Map()
  const buckets = new Map()
  let index = 0

  const mergeInto = (target, place) => {
    for (const [key, value] of Object.entries(place)) {
      if (key === 'id' || key === 'amapPoiId') continue
      if (Array.isArray(value)) {
        target[key] = [...new Set([...(target[key] || []), ...value])]
      } else if (value != null && value !== '') {
        target[key] = value
      }
    }
  }

  const findNearDuplicate = place => {
    const baseLat = Math.round(place.position[0] / 0.001); const baseLng = Math.round(place.position[1] / 0.001)
    for (let dLat = -1; dLat <= 1; dLat += 1) {
      for (let dLng = -1; dLng <= 1; dLng += 1) {
        const bucket = buckets.get(`${baseLat + dLat}:${baseLng + dLng}`)
        if (!bucket) continue
        for (const candidate of bucket) {
          if (candidate.name.toLowerCase() === place.name.toLowerCase() && haversineKm(candidate.position, place.position) < 0.05) return candidate
        }
      }
    }
    return null
  }

  return {
    get size() { return byId.size },
    add(rawPois) {
      let changed = false
      for (const poi of rawPois) {
        const place = normalizeAmapPoi(poi, origin, index, category); index += 1
        if (!place) continue
        if (place.distanceKm * 1000 > radiusMeters + 1) continue
        const existing = byId.get(place.amapPoiId)
        if (existing) {
          if ((!existing.rating && place.rating) || (!existing.image && place.image)) mergeInto(existing, place)
          continue
        }
        const near = findNearDuplicate(place)
        if (near) { mergeInto(near, place); continue }
        byId.set(place.amapPoiId, place)
        const key = `${Math.round(place.position[0] / 0.001)}:${Math.round(place.position[1] / 0.001)}`
        if (!buckets.has(key)) buckets.set(key, [])
        buckets.get(key).push(place)
        changed = true
      }
      return changed
    },
    list() {
      return [...byId.values()].sort((a, b) => a.distanceKm - b.distanceKm || ((b.rating ?? -1) - (a.rating ?? -1))).slice(0, maxResults)
    }
  }
}

/**
 * 抓一个圆。返回 saturated=true 表示「这个圆里还有更多结果，但我们撞上了单次查询的 200 条上限」，
 * 调用方据此决定要不要加环形分片。
 */
async function fetchCell(center, radiusMeters, category, config, signal, budget, onChunk) {
  const cacheKey = `${center.latitude.toFixed(3)},${center.longitude.toFixed(3)}:${Math.round(radiusMeters)}:${category}`
  const cached = cellCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < AMAP_CACHE_TTL_MS) { onChunk(cached.pois); return { saturated: cached.saturated } }

  const pois = []
  let saturated = false
  let complete = false
  for (let page = 1; page <= AMAP_MAX_PAGE; page += 1) {
    if (budget.remaining <= 0) break
    budget.remaining -= 1
    const params = {
      key: runtimeConfig.key,
      location: `${center.longitude.toFixed(6)},${center.latitude.toFixed(6)}`,
      radius: String(Math.round(radiusMeters)),
      sortrule: 'distance',
      page_num: String(page),
      page_size: String(AMAP_PAGE_SIZE),
      show_fields: 'business,photos'
    }
    // 只用 types 精确锁分类，不叠加 keywords：官方文档没有说明两者同时传入是「与」还是「或」，
    // 语义不确定就不该依赖。实测 types=050500 已能覆盖星巴克、M Stand 这类名称里没有「咖啡」的门店。
    if (config.types) params.types = config.types
    else if (config.keywords?.length) params.keywords = config.keywords.join('|')

    let data
    try {
      data = await requestPage(params, category, signal)
    } catch (error) {
      if (error.name === 'AbortError' || !pois.length) throw error
      break
    }
    const results = data.pois || []
    pois.push(...results)
    onChunk(results)
    if (results.length < AMAP_PAGE_SIZE) { complete = true; break }
    if (page === AMAP_MAX_PAGE) { saturated = true; complete = true }
  }

  // 只缓存正常翻完或达到分页上限的结果；失败、预算耗尽时允许下次重新补全。
  // 保存 saturated，使缓存命中后仍能触发环形补全。
  if (complete && pois.length) cellCache.set(cacheKey, { timestamp: Date.now(), pois, saturated })
  return { saturated }
}

/** 中心 + 6 片环：环心距与片半径都取 0.6R，实测可覆盖整个圆（片会越界，靠 collector 按真实距离裁掉）。 */
function ringCenters(center, radiusMeters) {
  const distance = radiusMeters * REFINE_GRID_RATIO
  const latRad = center.latitude * Math.PI / 180
  return Array.from({ length: RING_CELL_COUNT }, (_, i) => {
    const angle = (Math.PI / 3) * i
    return {
      latitude: center.latitude + (distance * Math.sin(angle)) / 111320,
      longitude: center.longitude + (distance * Math.cos(angle)) / (111320 * Math.cos(latRad))
    }
  })
}

/**
 * 检索附近地点。onProgress 会在每页返回后收到一次当前的完整列表（按距离排序），
 * 所以界面可以「先出最近的，再逐步补全」，而不是等全部拉完才显示。
 */
export async function fetchNearbyPlaces(location, signal, radiusMeters, category, onProgress) {
  if (!runtimeConfig.proxyUrl && !runtimeConfig.key) throw new Error('MISSING_AMAP_KEY')
  const config = CATEGORY_SEARCH[category] || CATEGORY_SEARCH.cafe
  const collector = createCollector(location, radiusMeters, category, MAX_RESULTS)
  const budget = { remaining: REQUEST_BUDGET }
  let emitted = -1
  const flush = () => { const list = collector.list(); if (list.length !== emitted) { emitted = list.length; onProgress?.(list) } }
  const onChunk = results => { if (collector.add(results)) flush() }

  const base = await fetchCell(location, radiusMeters, category, config, signal, budget, onChunk)
  flush()

  // 兜底：高德自己提示不要写死分类编码，所以万一某地分类型查询一条都没返回，就用关键词再试一次。
  // 只有「真的一条都没有」才会触发，正常情况不额外消耗配额。
  if (!collector.size && config.types && budget.remaining > 0 && !signal.aborted) {
    await fetchCell(location, radiusMeters, category, { ...config, types: '' }, signal, budget, onChunk)
    flush()
  }

  if (base.saturated && budget.remaining > 0 && !signal.aborted) {
    let previous = collector.size
    for (const center of ringCenters(location, radiusMeters)) {
      if (signal.aborted || budget.remaining <= 0 || collector.size >= MAX_RESULTS) break
      await fetchCell(center, radiusMeters * REFINE_GRID_RATIO, category, config, signal, budget, onChunk)
      // 收益递减就收手：新片带来的新增门店太少，说明这一带基本翻完了，没必要继续烧配额。
      if (collector.size - previous < RING_MIN_GAIN) break
      previous = collector.size
    }
  }
  flush()
  return collector.list()
}
