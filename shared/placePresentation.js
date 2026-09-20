import { isChainPlace } from './chains.js'

export function formatDistance(distanceKm) {
  if (!Number.isFinite(distanceKm)) return '距离未知'
  if (distanceKm < 1) {
    const meters = Math.max(10, Math.round((distanceKm * 1000) / 10) * 10)
    return `${meters} m`
  }
  return `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km`
}

export function estimateWalkMinutes(distanceKm) {
  if (!Number.isFinite(distanceKm)) return null
  return Math.max(1, Math.round((distanceKm * 1000) / 80))
}

export function placeFacts(place) {
  const facts = []
  const walkMinutes = estimateWalkMinutes(place?.distanceKm)
  if (walkMinutes != null) facts.push(`步行约 ${walkMinutes} 分钟`)
  if (place?.rating >= 4) facts.push(`${place.rating.toFixed(1)} 分`)
  if (place?.photos?.length) facts.push(`${place.photos.length} 张门店图`)
  if (place?.priceLabel) facts.push(place.priceLabel)
  return facts.slice(0, 3)
}

export function recommendationReason(place, curated = false) {
  if (!place) return ''
  if (curated) return '人工整理的口碑门店'
  if (place.rating >= 4.5 && place.photos?.length) return '高分且有门店实拍'
  if (place.distanceKm <= 0.3) return '就在附近，适合现在出发'
  if (!isChainPlace(place) && place.photos?.length) return '附近有图的独立小店'
  return '按实际距离为你找到'
}

function addUnique(result, seen, place, label) {
  if (!place || seen.has(place.id)) return
  seen.add(place.id)
  result.push({ place, label })
}

export function selectFeaturedPlaces(places, limit = 3, curatedPredicate = () => false) {
  if (!Array.isArray(places) || !places.length || limit <= 0) return []
  const byDistance = [...places].sort((a, b) => a.distanceKm - b.distanceKm)
  const highRated = places
    .filter(place => place.rating >= 4 && place.image)
    .sort((a, b) => b.rating - a.rating || a.distanceKm - b.distanceKm)[0]
  const curated = places
    .filter(curatedPredicate)
    .sort((a, b) => a.distanceKm - b.distanceKm)[0]
  const independent = places
    .filter(place => !isChainPlace(place) && place.image)
    .sort((a, b) => a.distanceKm - b.distanceKm)[0]

  const result = []
  const seen = new Set()
  addUnique(result, seen, byDistance[0], '离你最近')
  addUnique(result, seen, highRated, '高分有图')
  addUnique(result, seen, curated || independent, curated ? '口碑推荐' : '独立小店')
  for (const place of byDistance) {
    if (result.length >= limit) break
    addUnique(result, seen, place, '附近可选')
  }
  return result.slice(0, limit)
}

export function locationQuality(location) {
  if (!location) return { level: 'missing', label: '等待定位' }
  if (location.source === 'manual') return { level: 'manual', label: '地图选点' }
  if (location.isApproximate || location.source === 'ip' || !Number.isFinite(location.accuracy)) {
    return { level: 'rough', label: '大致位置' }
  }
  if (location.accuracy > 100) return { level: 'rough', label: `误差约 ${Math.round(location.accuracy)} m` }
  if (location.accuracy > 50) return { level: 'fair', label: `误差约 ${Math.round(location.accuracy)} m` }
  return { level: 'good', label: `精度约 ${Math.round(location.accuracy)} m` }
}
