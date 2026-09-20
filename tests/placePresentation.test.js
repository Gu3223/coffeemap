import test from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateWalkMinutes,
  formatDistance,
  locationQuality,
  placeFacts,
  recommendationReason,
  selectFeaturedPlaces
} from '../shared/placePresentation.js'

function place(id, overrides = {}) {
  return {
    id,
    name: `门店 ${id}`,
    distanceKm: 0.5,
    rating: null,
    image: null,
    photos: [],
    priceLabel: null,
    ...overrides
  }
}

test('距离和步行时间对近距离更易读', () => {
  assert.equal(formatDistance(0.043), '40 m')
  assert.equal(formatDistance(1.24), '1.2 km')
  assert.equal(estimateWalkMinutes(0.4), 5)
})

test('事实摘要只使用已有字段', () => {
  const facts = placeFacts(place('a', { distanceKm: 0.32, rating: 4.7, photos: ['1', '2'], priceLabel: '¥42' }))
  assert.deepEqual(facts, ['步行约 4 分钟', '4.7 分', '2 张门店图'])
  assert.equal(recommendationReason(place('b'), false), '按实际距离为你找到')
  assert.equal(recommendationReason(place('c'), true), '人工整理的口碑门店')
})

test('精选位按最近、高分有图、口碑去重', () => {
  const items = [
    place('nearest', { distanceKm: 0.1 }),
    place('rated', { distanceKm: 0.4, rating: 4.8, image: 'rated.jpg' }),
    place('curated', { distanceKm: 0.7, image: 'curated.jpg' })
  ]
  const featured = selectFeaturedPlaces(items, 3, item => item.id === 'curated')
  assert.deepEqual(featured.map(item => [item.place.id, item.label]), [
    ['nearest', '离你最近'],
    ['rated', '高分有图'],
    ['curated', '口碑推荐']
  ])
})

test('IP 与手动位置不会被描述成精准 GPS', () => {
  assert.deepEqual(locationQuality({ source: 'ip', accuracy: null, isApproximate: true }), { level: 'rough', label: '大致位置' })
  assert.deepEqual(locationQuality({ source: 'manual', accuracy: null }), { level: 'manual', label: '地图选点' })
  assert.deepEqual(locationQuality({ source: 'html5', accuracy: 24 }), { level: 'good', label: '精度约 24 m' })
})
