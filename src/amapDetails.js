const AMAP_DETAIL_PROXY_URL = import.meta.env.VITE_AMAP_DETAIL_PROXY || ''
const DETAIL_CACHE_TTL_MS = 10 * 60 * 1000
const POI_ID_PATTERN = /^B0[A-Za-z0-9]{4,30}$/
const detailCache = new Map()

export function hasAmapPoiId(value) {
  return POI_ID_PATTERN.test(value || '')
}

function asNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function normalizeDetail(poi) {
  const business = poi.business || {}
  return {
    rating: asNumber(poi.rating ?? business.rating),
    reviews: asNumber(business.rating_num || business.review_num),
    priceValue: asNumber(business.cost || poi.cost),
    priceLabel: asNumber(business.cost || poi.cost) ? `¥${Number(business.cost || poi.cost)}` : null,
    openingHours: business.opentime_today || business.opentime_week || business.opentime || null,
    todayHours: business.opentime_today || null,
    tel: poi.tel || null,
    businessArea: business.business_area || null,
    alias: business.alias || null,
    tag: business.tag || null,
    floor: poi.indoor?.truefloor || poi.indoor?.floor || null,
    hasEntrance: Boolean(poi.navi?.entr_location),
    photos: unique((poi.photos || []).map(photo => photo.url))
  }
}

export function mergeAmapDetail(place, detail) {
  if (!detail) return place
  const priceLabel = detail.priceLabel ? `${detail.priceLabel}${place.category === '按摩店' ? '起' : ''}` : place.priceLabel
  return {
    ...place,
    rating: detail.rating ?? place.rating,
    reviews: detail.reviews ?? place.reviews,
    priceValue: detail.priceValue ?? place.priceValue,
    priceLabel,
    openingHours: detail.openingHours || place.openingHours,
    todayHours: detail.todayHours || place.todayHours,
    tel: detail.tel || place.tel,
    businessArea: detail.businessArea || place.businessArea,
    alias: detail.alias || place.alias,
    floor: detail.floor || place.floor,
    hasEntrance: detail.hasEntrance || place.hasEntrance,
    tags: unique([...place.tags, detail.tag]),
    photos: unique([...detail.photos, ...place.photos]),
    image: detail.photos[0] || place.image
  }
}

export async function fetchAmapPlaceDetail(amapPoiId, signal) {
  if (!AMAP_DETAIL_PROXY_URL) throw new Error('DETAIL_PROXY_UNAVAILABLE')
  if (!hasAmapPoiId(amapPoiId)) throw new Error('INVALID_POI_ID')

  const cached = detailCache.get(amapPoiId)
  if (cached && Date.now() - cached.timestamp < DETAIL_CACHE_TTL_MS) return cached.detail

  const params = new URLSearchParams({ id: amapPoiId })
  const response = await fetch(`${AMAP_DETAIL_PROXY_URL}?${params}`, { signal })
  if (!response.ok) throw new Error('DETAIL_PROXY_UNAVAILABLE')
  const data = await response.json()
  if (data.status !== '1') {
    const error = new Error(data.info || 'Amap detail request failed')
    error.infocode = data.infocode
    throw error
  }

  const poi = (data.pois || []).find(item => item.id === amapPoiId) || data.pois?.[0]
  if (!poi) throw new Error('DETAIL_NOT_FOUND')
  const detail = normalizeDetail(poi)
  detailCache.set(amapPoiId, { timestamp: Date.now(), detail })
  return detail
}
