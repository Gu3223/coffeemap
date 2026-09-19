/**
 * 「我的收藏」本地存储层
 *
 * 之前的收藏只是 useState([])：刷新页面就全没了，而且导航里的「我的收藏」点了没有任何反应。
 * 这里把收藏真的存下来，并且**存门店快照而不只是 id** —— 因为收藏的意义就是「以后还要找得到」，
 * 只存 id 的话，等你离开那个区域（列表里不再有这家店）就永远打不开它了。
 *
 * 距离不用存：等展示时按当前定位重新算，否则会一直显示当初收藏时那个位置的距离。
 */

import { readJson, writeJson } from './localStore.js'
import { haversineKm } from './geo.js'

const STORAGE_KEY = 'xunyi-bei:favorites:v1'

/** 只挑展示需要的字段，避免把整个对象（含 photos 数组）无脑塞进 localStorage */
function snapshot(place) {
  return {
    id: place.id,
    amapPoiId: place.amapPoiId || null,
    name: place.name || '未命名地点',
    address: place.address || '',
    category: place.category || '',
    position: place.position || null,
    rating: typeof place.rating === 'number' ? place.rating : null,
    reviews: place.reviews ?? null,
    priceLabel: place.priceLabel || null,
    priceLevel: place.priceLevel || null,
    openingHours: place.openingHours || null,
    open: place.open ?? null,
    tags: Array.isArray(place.tags) ? place.tags.slice(0, 6) : [],
    image: place.image || null,
    photos: Array.isArray(place.photos) ? place.photos.slice(0, 8) : [],
    studySuitability: place.studySuitability || null,
    studyReason: place.studyReason || null,
    massageProfile: place.massageProfile || null,
    massageReason: place.massageReason || null,
    tel: place.tel || null,
    businessArea: place.businessArea || null,
    alias: place.alias || null,
    color: place.color || '#c46c42',
    source: place.source || 'amap',
    savedAt: Date.now()
  }
}

export function readFavorites(storage) {
  const parsed = readJson(STORAGE_KEY, {}, storage)
  const favorites = {}
  for (const [id, value] of Object.entries(parsed)) {
    if (value && typeof value === 'object' && value.name) favorites[id] = value
  }
  return favorites
}

export function writeFavorites(favorites, storage) {
  return writeJson(STORAGE_KEY, favorites, storage)
}

/** 收藏/取消收藏，返回新的映射（不修改传入对象） */
export function toggleFavorite(favorites, place) {
  if (!place?.id) return favorites
  const next = { ...favorites }
  if (next[place.id]) delete next[place.id]
  else next[place.id] = snapshot(place)
  writeFavorites(next)
  return next
}

export function isFavorite(favorites, place) {
  return Boolean(place?.id && favorites[place.id])
}

/**
 * 收藏列表 → 可直接渲染的门店数组。传了当前位置就用真实距离覆盖快照里的旧距离，
 * 这样「我的收藏」里显示的距离始终是「离你现在多远」。
 */
export function favoritePlaces(favorites, location) {
  return Object.values(favorites).map(place => {
    if (!location || !Array.isArray(place.position)) return place
    return { ...place, distanceKm: haversineKm([location.latitude, location.longitude], place.position) }
  })
}
