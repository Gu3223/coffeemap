/**
 * 地理计算：与高德接口、浏览器环境都无关的纯函数。
 *
 * 单独抽出来的原因：收藏模块也要按当前位置算距离，但它不应该为了一个 haversine
 * 去依赖 amapSearch（后者在模块顶层读 import.meta.env，脱离 Vite 就没法单独测试）。
 */

export function haversineKm(a, b) {
  const radians = value => value * Math.PI / 180
  const dLat = radians(b[0] - a[0]); const dLng = radians(b[1] - a[1])
  const latA = radians(a[0]); const latB = radians(b[0])
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(latA) * Math.cos(latB)
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}
