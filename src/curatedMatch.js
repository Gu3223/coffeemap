/**
 * 口碑推荐的纯逻辑：清洗与匹配。
 *
 * 单独分出来的原因：数据装载（`curated-places.json`）是 Vite 的能力，
 * Node 直接 import JSON 需要 `with { type: 'json' }`。把逻辑做成不依赖数据装载的纯函数，
 * 就能用 Node 直接跑测试（测试读同一个 JSON 文件后传进来）。
 */

export const CURATED_SCORE_MIN = 0
export const CURATED_SCORE_MAX = 10

/** 归一化：去括号内容、去标点与空白、转小写，用于名称兜底匹配 */
export function normalizePlaceName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[（(【[].*?[）)】\]]/g, '')
    .replace(/[\s·、,，.。\-—_/\\|]+/g, '')
}

export function sanitizeCuratedEntries(rawEntries) {
  if (!Array.isArray(rawEntries)) return []
  return rawEntries
    .map(raw => {
      if (!raw || typeof raw !== 'object') return null
      const name = String(raw.name || '').trim()
      if (!name) return null
      const score = Number(raw.score)
      return {
        amapPoiId: raw.amapPoiId ? String(raw.amapPoiId) : null,
        name,
        normalizedName: normalizePlaceName(name),
        score: Number.isFinite(score) ? Math.min(Math.max(score, CURATED_SCORE_MIN), CURATED_SCORE_MAX) : null,
        source: String(raw.source || '').trim() || '人工整理',
        note: String(raw.note || '').trim() || null
      }
    })
    .filter(Boolean)
}

/**
 * 按 POI id 精确匹配，失败再按名称匹配。
 * 名称用包含判断，因为高德的门店名常带分店后缀（「申·CAFE(人民广场店)」对「申·CAFE」）。
 */
export function findCuratedEntry(entries, place) {
  if (!place || !Array.isArray(entries) || !entries.length) return null
  if (place.amapPoiId) {
    const byId = entries.find(entry => entry.amapPoiId && entry.amapPoiId === String(place.amapPoiId))
    if (byId) return byId
  }
  const placeName = normalizePlaceName(place.name)
  if (!placeName) return null
  return entries.find(entry => entry.normalizedName && (placeName === entry.normalizedName || placeName.includes(entry.normalizedName))) || null
}
