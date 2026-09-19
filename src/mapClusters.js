/**
 * 地图标记聚合（纯函数，与 Leaflet 解耦，便于单独测试）
 *
 * 为什么需要：搜索半径 500 米内经常有 40+ 家咖啡店，逐个画标记会在市中心糊成一团看不出任何信息
 * —— 桌面端和手机端都是如此，手机端尤其严重。
 *
 * 做法：按当前缩放级别把经纬度切成固定像素大小的格子，落在同一格的门店合并成一个标记，
 * 数量大于 1 时显示计数。格子尺寸随缩放变化，所以放大后会自动散开成单个标记。
 */

/** Web Mercator 下，缩放级别 zoom 时 1 个像素对应多少经度 */
function degreesPerPixel(zoom) {
  return 360 / (256 * 2 ** zoom)
}

/** 代表门店：优先评分高的（标记上显示的就是它的评分），其次距离近的 */
function pickRepresentative(members) {
  return [...members].sort((a, b) => {
    const ratingA = a.rating ?? -1; const ratingB = b.rating ?? -1
    if (ratingB !== ratingA) return ratingB - ratingA
    return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)
  })[0]
}

export function clusterPlaces(places, zoom, cellPixels = 58) {
  const step = degreesPerPixel(zoom) * cellPixels
  if (!Number.isFinite(step) || step <= 0) return places.map(place => ({ key: place.id, place, places: [place], count: 1 }))

  const cells = new Map()
  for (const place of places) {
    const latitude = place.position?.[0]; const longitude = place.position?.[1]
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue
    // 纬度方向在 Mercator 里被拉伸，按 cos(纬度) 修正，否则格子不是正方形
    const latStep = step * Math.cos((latitude * Math.PI) / 180)
    const key = `${Math.round(longitude / step)}:${Math.round(latitude / latStep)}`
    const bucket = cells.get(key)
    if (bucket) bucket.push(place)
    else cells.set(key, [place])
  }

  return [...cells.entries()].map(([key, members]) => ({
    key,
    place: pickRepresentative(members),
    // 多店聚合用格子重心而不是代表门店的坐标：代表项可能贴着格子边界，
    // 相邻两格的标记就会叠在一起；用重心则由格子尺寸保证互不重叠。
    center: [
      members.reduce((sum, item) => sum + item.position[0], 0) / members.length,
      members.reduce((sum, item) => sum + item.position[1], 0) / members.length
    ],
    places: members,
    count: members.length
  }))
}
