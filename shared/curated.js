/**
 * 口碑推荐（人工策展）
 *
 * 背景：高德 API 只给评分，不给评价正文，也没有「哪些店被反复推荐」这类信息。
 * 小红书等平台的 UGC 不能抓：其 robots.txt 对 `User-agent: *` 是 `Disallow: /`，
 * 抓取再发布还涉及用户著作权与平台协议。所以这一层只接受**合法来源**的数据：
 *   - 你自己刷到并记下的店（人读不算抓取）；
 *   - 公开榜单、文章里反复出现的店名（只记分数与来源链接，不抄正文、不存图）；
 *   - 将来若有官方开放平台权限，走 API。
 *
 * 数据写在 ./curated-places.json，一条一项：
 *   {
 *     "amapPoiId": "B0L0LM8N6M",      // 可选但最好给，高德 POI id，匹配最准
 *     "name": "愿景100咖啡",           // 必给，id 缺失或对不上时按名称兜底
 *     "score": 9,                      // 0-10 口碑分，超范围会夹紧
 *     "source": "小红书 @某某 2026-09", // 必给，会显示在详情抽屉里
 *     "note": "手冲稳，靠窗位安静"       // 可选，自己写的一句话，不要抄原文
 *   }
 *
 * 设计取舍：匹配失败只是「不加分」，不会隐藏门店。策展数据是加分项，不是准入门槛。
 * 这样即使门店改名、换 POI id、或名称对不上，应用其他部分照常工作。
 */

import entries from './curated-places.json'
import { findCuratedEntry, sanitizeCuratedEntries } from './curatedMatch'

const CURATED = sanitizeCuratedEntries(entries)

export function curatedEntryFor(place) {
  return findCuratedEntry(CURATED, place)
}

export function isCurated(place) {
  return curatedEntryFor(place) !== null
}

/** 口碑分；没有策展记录时返回 null，便于排序时区分「有口碑」与「无口碑」 */
export function curatedScore(place) {
  return curatedEntryFor(place)?.score ?? null
}

export function curatedCount() {
  return CURATED.length
}
