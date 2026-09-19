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
 * 名称兜底匹配。
 *
 * 只用「归一化后完全相等」，或「门店名以策展名开头」两种情况。
 *
 * 为什么不用 includes：实测高德存在归一化后只剩通用词的门店名（如 `COFFEE(恒润广场店)` 归一化成
 * `coffee`），用子串判断会把「T12 coffee」这类策展名错配上去；短名同样危险，
 * 「Opia」会命中「UtopiaPortal池」。改成「以策展名开头」后这两种假命中都不会发生，
 * 而分店后缀的情形（`忍忍咖啡惠吉西路总店`）仍然匹配得到。
 */
const MIN_CONTAINMENT_LENGTH = 4

export function findCuratedEntry(entries, place) {
  if (!place || !Array.isArray(entries) || !entries.length) return null
  if (place.amapPoiId) {
    const byId = entries.find(entry => entry.amapPoiId && entry.amapPoiId === String(place.amapPoiId))
    if (byId) return byId
  }
  const placeName = normalizePlaceName(place.name)
  if (!placeName) return null
  const exact = entries.find(entry => entry.normalizedName && placeName === entry.normalizedName)
  if (exact) return exact
  return entries.find(entry => {
    const target = entry.normalizedName
    if (!target || target.length < MIN_CONTAINMENT_LENGTH) return false
    // 门店名更长且以策展名开头，视为同一家的分店写法
    return placeName.length > target.length && placeName.startsWith(target)
  }) || null
}
