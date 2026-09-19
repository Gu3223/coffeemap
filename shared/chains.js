/**
 * 连锁品牌识别
 *
 * 目的：把大型连锁排到列表后面，让独立小店先被看到。
 *
 * 判定只用门店名称：高德返回的 business 字段里没有可靠的品牌标识
 * （实测 keytag 一律是「咖啡」，alias 多数为空），名称匹配是唯一稳定信号。
 * 匹配前去掉空格并转小写，因此中英文写法和带不带空格都能命中。
 *
 * 注意：这是启发式，不保证覆盖全部连锁，也会随品牌增减而失效。
 * 用在「排序」上足够安全（判错只是顺序不同），但不要用它做硬性过滤而不给用户退路。
 */

const CHAIN_KEYWORDS = [
  // 国际连锁
  '星巴克', 'starbucks', 'costa', '咖世家', 'peets', '皮爷', 'tims', '天好咖啡',
  'arabica', 'bluebottle', '蓝瓶', 'pacificcoffee', '太平洋咖啡', 'caffenero', '世家兰铎',
  '麦当劳', 'mcdonald', 'mccafe', 'luckin', '瑞幸',
  // 国内连锁
  '库迪', 'cotti', 'manner', 'mstand', 'seesaw', 'nowwa', '挪瓦', '幸运咖', 'illy', 'lavazza',
  '上岛咖啡', '迪欧咖啡', '漫咖啡', 'maancoffee', 'costaexpress', '咖啡之翼',
  // 便利店与快餐的咖啡档口
  'family mart', 'familymart', '全家', 'lawson', '罗森', '7-eleven', '7eleven', '711', '7-11',
  '便利蜂', '肯德基', 'kfc'
]

const normalized = value => String(value || '').toLowerCase().replace(/\s+/g, '')

const NORMALIZED_KEYWORDS = CHAIN_KEYWORDS.map(normalized)

export function isChainPlace(place) {
  const name = normalized(place?.name)
  if (!name) return false
  return NORMALIZED_KEYWORDS.some(keyword => name.includes(keyword))
}

/** 排序用：独立门店 0，连锁 1。放在排序键最前面即可让连锁沉底。 */
export function chainRank(place) {
  return isChainPlace(place) ? 1 : 0
}
